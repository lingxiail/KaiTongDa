//! Network isolation proxy for sandboxed shell commands.
//!
//! A lightweight HTTP/CONNECT proxy that enforces domain whitelist rules.
//! Sandboxed commands use HTTP_PROXY/HTTPS_PROXY env vars to route traffic
//! through this proxy. Non-whitelisted domains are blocked with a clear error.
//!
//! Supports:
//! - Exact domains: `github.com`
//! - Wildcard domains: `*.company.com` (matches subdomains + the domain itself)
//! - CIDR ranges: `10.0.0.0/8`
//! - RFC 1918 private networks toggle

use std::io::{self, BufRead, BufReader, Write};
use std::net::{IpAddr, Ipv4Addr, TcpListener, TcpStream, ToSocketAddrs};
use std::sync::{Arc, OnceLock, RwLock};
use std::thread;
use std::time::Duration;

/// Proxy listen port, set once at startup.
static PROXY_PORT: OnceLock<u16> = OnceLock::new();

/// Shared whitelist config, updatable at runtime.
static WHITELIST: OnceLock<Arc<RwLock<WhitelistConfig>>> = OnceLock::new();

/// Default domains that are always whitelisted (package registries, code hosting).
const DEFAULT_WHITELIST: &[&str] = &[
    // Package registries
    "registry.npmjs.org",
    "registry.yarnpkg.com",
    "registry.npmmirror.com",
    "pypi.org",
    "files.pythonhosted.org",
    "crates.io",
    "rubygems.org",
    // Code hosting
    "github.com",
    "*.github.com",
    "*.githubusercontent.com",
    "gitlab.com",
    "*.gitlab.com",
    "bitbucket.org",
    // LLM APIs
    "api.anthropic.com",
    "api.openai.com",
    "api.deepseek.com",
    // Common CDNs
    "cdn.jsdelivr.net",
    "unpkg.com",
];

struct WhitelistConfig {
    entries: Vec<WhitelistEntry>,
    allow_private_networks: bool,
}

enum WhitelistEntry {
    /// Exact domain match: "github.com"
    Domain(String),
    /// Wildcard: "*.foo.com" → matches foo.com and *.foo.com
    WildcardDomain(String),
    /// IPv4 CIDR: 10.0.0.0/8
    Cidr { network: u32, mask: u32 },
}

/// Get the proxy port (None if proxy not started).
pub fn get_proxy_port() -> Option<u16> {
    PROXY_PORT.get().copied()
}

/// Start the proxy server. Returns the port it's listening on.
pub fn start_proxy(user_whitelist: &[String], allow_private: bool) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind network proxy");
    let port = listener.local_addr().unwrap().port();
    PROXY_PORT.set(port).ok();

    let config = Arc::new(RwLock::new(build_config(user_whitelist, allow_private)));
    WHITELIST.set(config.clone()).ok();

    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let config = config.clone();
            thread::spawn(move || {
                if let Err(e) = handle_connection(stream, &config) {
                    eprintln!("[proxy] connection error: {}", e);
                }
            });
        }
    });

    eprintln!("[proxy] listening on 127.0.0.1:{}", port);
    port
}

/// Update whitelist at runtime (called from Tauri command).
pub fn update_whitelist(user_whitelist: &[String], allow_private: bool) {
    if let Some(wl) = WHITELIST.get() {
        if let Ok(mut cfg) = wl.write() {
            *cfg = build_config(user_whitelist, allow_private);
        }
    }
}

// ── Connection handling ──

fn handle_connection(
    mut client: TcpStream,
    config: &Arc<RwLock<WhitelistConfig>>,
) -> io::Result<()> {
    client.set_read_timeout(Some(Duration::from_secs(30)))?;

    let client_clone = client.try_clone()?;
    let mut reader = BufReader::new(client_clone);

    // Read request line: "CONNECT host:443 HTTP/1.1" or "GET http://... HTTP/1.1"
    let mut request_line = String::with_capacity(512);
    reader.read_line(&mut request_line)?;

    let parts: Vec<&str> = request_line.trim().splitn(3, ' ').collect();
    if parts.len() < 2 {
        return send_error(&mut client, 400, "Bad Request");
    }

    let method = parts[0];
    let target = parts[1];

    // Extract host from request
    let host = if method.eq_ignore_ascii_case("CONNECT") {
        // CONNECT host:port HTTP/1.1
        target.split(':').next().unwrap_or("").to_string()
    } else {
        // Regular HTTP: parse URL or read Host header
        extract_host_from_url(target).unwrap_or_else(|| {
            extract_host_header(&mut reader).unwrap_or_default()
        })
    };

    if host.is_empty() {
        return send_error(&mut client, 400, "Cannot determine target host");
    }

    // Check whitelist
    let allowed = {
        let cfg = config.read().unwrap();
        is_host_allowed(&host, &cfg)
    };

    if !allowed {
        eprintln!("[proxy] BLOCKED: {}", host);
        return send_error(
            &mut client,
            403,
            &format!("[sandbox-network-blocked] {} is not in the network whitelist", host),
        );
    }

    // Drain remaining headers
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            break;
        }
    }

    if method.eq_ignore_ascii_case("CONNECT") {
        handle_connect(client, target)
    } else {
        handle_http_forward(client, &request_line, target)
    }
}

/// HTTPS tunneling via CONNECT method.
fn handle_connect(mut client: TcpStream, target: &str) -> io::Result<()> {
    let server = TcpStream::connect(target).map_err(|e| {
        let _ = send_error(&mut client, 502, &format!("Cannot connect to {}: {}", target, e));
        e
    })?;

    // Tell client the tunnel is established
    client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")?;
    client.flush()?;

    // Set timeouts for the tunnel
    let timeout = Some(Duration::from_secs(300));
    client.set_read_timeout(timeout)?;
    server.set_read_timeout(timeout)?;

    // Bidirectional pipe
    let mut c2s_client = client.try_clone()?;
    let mut c2s_server = server.try_clone()?;

    let t1 = thread::spawn(move || {
        let _ = io::copy(&mut c2s_client, &mut c2s_server);
        let _ = c2s_server.shutdown(std::net::Shutdown::Write);
    });

    let mut s2c_server = server;
    let mut s2c_client = client;
    let t2 = thread::spawn(move || {
        let _ = io::copy(&mut s2c_server, &mut s2c_client);
        let _ = s2c_client.shutdown(std::net::Shutdown::Write);
    });

    let _ = t1.join();
    let _ = t2.join();
    Ok(())
}

/// Forward a plain HTTP request.
fn handle_http_forward(mut client: TcpStream, request_line: &str, url: &str) -> io::Result<()> {
    // Parse target from URL: http://host:port/path
    let without_scheme = url
        .strip_prefix("http://")
        .unwrap_or(url);
    let (host_port, _path) = without_scheme
        .split_once('/')
        .unwrap_or((without_scheme, "/"));

    let target = if host_port.contains(':') {
        host_port.to_string()
    } else {
        format!("{}:80", host_port)
    };

    let mut server = TcpStream::connect(&target).map_err(|e| {
        let _ = send_error(&mut client, 502, &format!("Cannot connect to {}: {}", target, e));
        e
    })?;

    // Forward the original request
    server.write_all(request_line.as_bytes())?;
    server.write_all(b"\r\n")?;
    server.flush()?;

    // Pipe bidirectionally (same as CONNECT)
    let timeout = Some(Duration::from_secs(60));
    client.set_read_timeout(timeout)?;
    server.set_read_timeout(timeout)?;

    let mut c2s_client = client.try_clone()?;
    let mut c2s_server = server.try_clone()?;

    let t1 = thread::spawn(move || {
        let _ = io::copy(&mut c2s_client, &mut c2s_server);
        let _ = c2s_server.shutdown(std::net::Shutdown::Write);
    });

    let mut s2c_server = server;
    let mut s2c_client = client;
    let t2 = thread::spawn(move || {
        let _ = io::copy(&mut s2c_server, &mut s2c_client);
        let _ = s2c_client.shutdown(std::net::Shutdown::Write);
    });

    let _ = t1.join();
    let _ = t2.join();
    Ok(())
}

fn send_error(client: &mut TcpStream, code: u16, message: &str) -> io::Result<()> {
    let reason = match code {
        400 => "Bad Request",
        403 => "Forbidden",
        502 => "Bad Gateway",
        _ => "Error",
    };
    let body = format!(
        "<html><body><h1>{} {}</h1><p>{}</p></body></html>",
        code, reason, message
    );
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        code,
        reason,
        body.len(),
        body
    );
    client.write_all(response.as_bytes())?;
    client.flush()
}

// ── Whitelist matching ──

fn is_host_allowed(host: &str, config: &WhitelistConfig) -> bool {
    let host_lower = host.to_lowercase();

    // Check if host is an IP address
    if let Ok(ip) = host_lower.parse::<IpAddr>() {
        // Check RFC 1918 private networks
        if config.allow_private_networks {
            if is_private_ip(&ip) {
                return true;
            }
        }
        // Always allow localhost
        if ip.is_loopback() {
            return true;
        }
        // Check CIDR entries
        if let IpAddr::V4(v4) = ip {
            let ip_u32 = u32::from(v4);
            for entry in &config.entries {
                if let WhitelistEntry::Cidr { network, mask } = entry {
                    if ip_u32 & mask == *network {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // Domain matching
    for entry in &config.entries {
        match entry {
            WhitelistEntry::Domain(d) => {
                if host_lower == *d {
                    return true;
                }
            }
            WhitelistEntry::WildcardDomain(suffix) => {
                // *.foo.com matches both "foo.com" and "bar.foo.com"
                if host_lower == *suffix || host_lower.ends_with(&format!(".{}", suffix)) {
                    return true;
                }
            }
            WhitelistEntry::Cidr { .. } => {} // IP-only, skip for domain
        }
    }

    // DNS resolution: check if resolved IP matches any CIDR/private rules
    if config.allow_private_networks {
        if let Ok(addrs) = (host_lower.as_str(), 0u16).to_socket_addrs() {
            for addr in addrs {
                if is_private_ip(&addr.ip()) || addr.ip().is_loopback() {
                    return true;
                }
            }
        }
    }

    false
}

fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            // 10.0.0.0/8
            octets[0] == 10
            // 172.16.0.0/12
            || (octets[0] == 172 && (16..=31).contains(&octets[1]))
            // 192.168.0.0/16
            || (octets[0] == 192 && octets[1] == 168)
            // 127.0.0.0/8
            || octets[0] == 127
        }
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

// ── Config parsing ──

fn build_config(user_entries: &[String], allow_private: bool) -> WhitelistConfig {
    let mut entries = Vec::new();

    // Add defaults
    for &d in DEFAULT_WHITELIST {
        entries.push(parse_entry(d));
    }

    // Add user entries
    for entry in user_entries {
        let trimmed = entry.trim();
        if !trimmed.is_empty() && !trimmed.starts_with('#') {
            entries.push(parse_entry(trimmed));
        }
    }

    WhitelistConfig {
        entries,
        allow_private_networks: allow_private,
    }
}

fn parse_entry(s: &str) -> WhitelistEntry {
    let s = s.trim().to_lowercase();

    // CIDR: "10.0.0.0/8"
    if let Some((ip_str, bits_str)) = s.split_once('/') {
        if let (Ok(ip), Ok(bits)) = (ip_str.parse::<Ipv4Addr>(), bits_str.parse::<u8>()) {
            if bits <= 32 {
                let mask = if bits == 0 { 0u32 } else { !0u32 << (32 - bits) };
                let network = u32::from(ip) & mask;
                return WhitelistEntry::Cidr { network, mask };
            }
        }
    }

    // Wildcard: "*.foo.com"
    if let Some(domain) = s.strip_prefix("*.") {
        return WhitelistEntry::WildcardDomain(domain.to_string());
    }

    // Exact domain or IP
    WhitelistEntry::Domain(s)
}

fn extract_host_from_url(url: &str) -> Option<String> {
    let without_scheme = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))?;
    let host_port = without_scheme.split('/').next()?;
    let host = host_port.split(':').next()?;
    if host.is_empty() {
        None
    } else {
        Some(host.to_lowercase())
    }
}

fn extract_host_header(reader: &mut BufReader<TcpStream>) -> Option<String> {
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            break;
        }
        if line.to_lowercase().starts_with("host:") {
            let value = line[5..].trim();
            let host = value.split(':').next().unwrap_or("").to_lowercase();
            if !host.is_empty() {
                return Some(host);
            }
        }
    }
    None
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_exact_domain() {
        let entry = parse_entry("github.com");
        assert!(matches!(entry, WhitelistEntry::Domain(d) if d == "github.com"));
    }

    #[test]
    fn parse_wildcard_domain() {
        let entry = parse_entry("*.company.com");
        assert!(matches!(entry, WhitelistEntry::WildcardDomain(d) if d == "company.com"));
    }

    #[test]
    fn parse_cidr() {
        let entry = parse_entry("10.0.0.0/8");
        assert!(matches!(entry, WhitelistEntry::Cidr { .. }));
    }

    #[test]
    fn match_exact_domain() {
        let config = build_config(&[], false);
        assert!(is_host_allowed("github.com", &config));
        assert!(is_host_allowed("GITHUB.COM", &config));
        assert!(!is_host_allowed("evil.com", &config));
    }

    #[test]
    fn match_wildcard_domain() {
        let config = build_config(&["*.company.com".to_string()], false);
        assert!(is_host_allowed("company.com", &config));
        assert!(is_host_allowed("api.company.com", &config));
        assert!(is_host_allowed("deep.sub.company.com", &config));
        assert!(!is_host_allowed("notcompany.com", &config));
    }

    #[test]
    fn match_private_networks() {
        let config_off = build_config(&[], false);
        assert!(!is_host_allowed("10.1.2.3", &config_off));
        assert!(!is_host_allowed("192.168.1.100", &config_off));

        let config_on = build_config(&[], true);
        assert!(is_host_allowed("10.1.2.3", &config_on));
        assert!(is_host_allowed("192.168.1.100", &config_on));
        assert!(is_host_allowed("172.16.0.1", &config_on));
        assert!(is_host_allowed("127.0.0.1", &config_on));
    }

    #[test]
    fn match_cidr() {
        let config = build_config(&["172.20.0.0/16".to_string()], false);
        assert!(is_host_allowed("172.20.1.1", &config));
        assert!(is_host_allowed("172.20.255.255", &config));
        assert!(!is_host_allowed("172.21.0.1", &config));
    }

    #[test]
    fn localhost_always_allowed() {
        let config = build_config(&[], false);
        assert!(is_host_allowed("127.0.0.1", &config));
    }

    #[test]
    fn extract_host_from_http_url() {
        assert_eq!(
            extract_host_from_url("http://example.com/path"),
            Some("example.com".to_string())
        );
        assert_eq!(
            extract_host_from_url("http://example.com:8080/path"),
            Some("example.com".to_string())
        );
        assert_eq!(extract_host_from_url("/path"), None);
    }

    #[test]
    fn default_whitelist_includes_essentials() {
        let config = build_config(&[], false);
        assert!(is_host_allowed("registry.npmjs.org", &config));
        assert!(is_host_allowed("github.com", &config));
        assert!(is_host_allowed("api.github.com", &config));
        assert!(is_host_allowed("api.anthropic.com", &config));
    }
}
