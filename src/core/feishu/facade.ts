import type { FeishuConnectInput, FeishuConnectionStatus } from './types';
import { FeishuAuthService, feishuAuthService } from './authService';

export class FeishuFacade {
  constructor(private readonly authService: FeishuAuthService = feishuAuthService) {}

  async connect(input: FeishuConnectInput = {}): Promise<FeishuConnectionStatus> {
    return await this.authService.startLogin(input);
  }

  async getAuthStatus(input?: Pick<FeishuConnectInput, 'appId' | 'domain'>): Promise<FeishuConnectionStatus> {
    return await this.authService.pollLoginStatus(input);
  }

  async disconnect(input?: Pick<FeishuConnectInput, 'appId' | 'domain'>): Promise<FeishuConnectionStatus> {
    return await this.authService.disconnect(input);
  }
}

export const feishuFacade = new FeishuFacade();
