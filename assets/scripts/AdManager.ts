import { sys } from 'cc';

/**
 * 全局统一广告管理器
 * 负责封装各平台（小游戏/Native）的广告 SDK，提供基于 Promise 的异步调用。
 */
export class AdManager {
    private static _instance: AdManager;

    public static get instance(): AdManager {
        if (!this._instance) {
            this._instance = new AdManager();
        }
        return this._instance;
    }

    private isBannerShowing = false;
    private interstitialCount = 0; // 插屏计数器，3局一次

    private constructor() {
        this.init();
    }

    /**
     * 初始化广告配置
     */
    public init(): void {
        console.log('[AdManager] 初始化广告 SDK...');
        if (sys.isNative) {
            // 根据 sys.os 或 sys.language 等来区分国内海外配置
            // 例如：如果是 iOS 且国内，使用穿山甲；海外使用 AdMob
            console.log('[AdManager] 检测到 Native 环境，加载原生广告配置 (Domestic/Overseas)');
        } else if (sys.platform === sys.Platform.WECHAT_GAME) {
            console.log('[AdManager] 检测到微信小游戏环境');
        } else if (sys.platform === sys.Platform.BYTEDANCE_MINI_GAME) {
            console.log('[AdManager] 检测到抖音小游戏环境');
        } else {
            console.log('[AdManager] 网页或调试环境，使用模拟广告');
        }
    }

    /**
     * 播放激励视频 (Rewarded Video)
     * @param scenario 场景名称 (如: 'revive', 'double_coin', 'energy_refill', 'shop_freebie')
     * @returns Promise<boolean> 玩家是否成功观看完视频
     */
    public showRewardedVideo(scenario: string): Promise<boolean> {
        return new Promise((resolve) => {
            console.log(`[AdManager] 请求播放激励视频，场景: ${scenario}`);
            
            // 模拟平台调用逻辑
            // 在实际项目中，这里会调用 wx.createRewardedVideoAd 等 API，绑定 onClose 回调
            
            // 为了调试方便，我们在 Web 环境下延迟 1 秒后默认模拟成功
            setTimeout(() => {
                console.log(`[AdManager] 激励视频观看完毕 (${scenario})`);
                resolve(true); 
                // 若用户中途退出，则 resolve(false)
            }, 1000);
        });
    }

    /**
     * 判断下一次是否会展示插屏广告
     */
    public shouldShowInterstitial(force: boolean = false): boolean {
        return force || ((this.interstitialCount + 1) % 3 === 0);
    }

    /**
     * 播放插屏广告 (Interstitial)
     * @param force 是否无视频次强制播放
     */
    public showInterstitial(force: boolean = false): void {
        this.interstitialCount++;
        
        // 每 3 局（或 3 次请求）播放一次插屏
        if (!force && this.interstitialCount % 3 !== 0) {
            return;
        }

        console.log('[AdManager] 弹出插屏广告');
        // 实际接入时调用插屏 SDK
    }

    /**
     * 展示底部横幅广告 (Banner)
     */
    public showBanner(): void {
        if (this.isBannerShowing) return;
        this.isBannerShowing = true;
        console.log('[AdManager] 显示底部 Banner 广告');
        // 调用平台显示 banner
    }

    /**
     * 隐藏底部横幅广告 (Banner)
     */
    public hideBanner(): void {
        if (!this.isBannerShowing) return;
        this.isBannerShowing = false;
        console.log('[AdManager] 隐藏底部 Banner 广告');
        // 调用平台隐藏 banner
    }
}
