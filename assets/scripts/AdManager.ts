import { resources, JsonAsset, sys } from 'cc';

type RewardedCloseResult = {
    isEnded?: boolean;
};

interface WechatRewardedVideoAd {
    show(): Promise<void>;
    load(): Promise<void>;
    onClose(callback: (result?: RewardedCloseResult) => void): void;
    offClose?(callback: (result?: RewardedCloseResult) => void): void;
    onError(callback: (error: unknown) => void): void;
}

interface WechatBannerAd {
    style: {
        left: number;
        top: number;
        width: number;
    };
    show(): Promise<void>;
    hide(): void;
    destroy(): void;
    onResize?(callback: (size: { width: number; height: number }) => void): void;
    onError(callback: (error: unknown) => void): void;
}

interface WechatInterstitialAd {
    show(): Promise<void>;
    load(): Promise<void>;
    onError(callback: (error: unknown) => void): void;
}

interface WechatApi {
    createRewardedVideoAd(options: { adUnitId: string }): WechatRewardedVideoAd;
    createBannerAd(options: {
        adUnitId: string;
        style: { left: number; top: number; width: number };
    }): WechatBannerAd;
    createInterstitialAd(options: { adUnitId: string }): WechatInterstitialAd;
    getSystemInfoSync(): { windowWidth: number; windowHeight: number };
}

declare const wx: WechatApi;

interface AdConfig {
    enabled?: boolean;
    wechatGame?: {
        bannerAdUnitId?: string;
        rewardedAdUnitId?: string;
        interstitialAdUnitId?: string;
        banner?: {
            enabled?: boolean;
            bottomOffset?: number;
        };
        rewarded?: {
            enabled?: boolean;
            loadTimeoutMs?: number;
            scenarios?: Record<string, boolean>;
        };
        interstitial?: {
            enabled?: boolean;
            requestInterval?: number;
        };
    };
}

const DEFAULT_CONFIG: Required<AdConfig> = {
    enabled: true,
    wechatGame: {
        bannerAdUnitId: '',
        rewardedAdUnitId: '',
        interstitialAdUnitId: '',
        banner: {
            enabled: true,
            bottomOffset: 0,
        },
        rewarded: {
            enabled: true,
            loadTimeoutMs: 10000,
            scenarios: {
                revive: true,
                double_coin: true,
                energy_refill: true,
                shop_freebie: true,
                title_free_gacha: true,
                title_ten_half: true,
            },
        },
        interstitial: {
            enabled: true,
            requestInterval: 3,
        },
    },
};

/**
 * 全局统一广告管理器。
 * 微信小游戏中调用 wx 广告 API，Web/编辑器预览中保留模拟广告行为。
 */
export class AdManager {
    private static _instance: AdManager;

    public static get instance(): AdManager {
        if (!this._instance) {
            this._instance = new AdManager();
        }
        return this._instance;
    }

    private config: Required<AdConfig> = DEFAULT_CONFIG;
    private configLoaded = false;
    private configLoadingStarted = false;
    private configReadyCallbacks: (() => void)[] = [];
    private isBannerShowing = false;
    private bannerWanted = false;
    private bannerShowPending = false;
    private rewardedInProgress = false;
    private interstitialCount = 0;
    private wechatRewardedAd: WechatRewardedVideoAd | null = null;
    private wechatBannerAd: WechatBannerAd | null = null;
    private wechatInterstitialAd: WechatInterstitialAd | null = null;
    private warnedConfigKeys = new Set<string>();

    private constructor() {
        this.init();
    }

    /** 初始化平台识别和广告配置。 */
    public init(): void {
        console.log('[AdManager] 初始化广告 SDK...');
        if (sys.isNative) {
            console.log('[AdManager] 检测到 Native 环境，等待原生广告 SDK 接入');
        } else if (this.isWechatGame()) {
            console.log('[AdManager] 检测到微信小游戏环境');
            this.loadConfig();
        } else if (sys.platform === sys.Platform.BYTEDANCE_MINI_GAME) {
            console.log('[AdManager] 检测到抖音小游戏环境');
        } else {
            console.log('[AdManager] 网页或调试环境，使用模拟广告');
        }
    }

    /** 播放激励视频，只有完整观看后才返回 true。 */
    public showRewardedVideo(scenario: string): Promise<boolean> {
        if (!this.isWechatGame()) {
            return this.showSimulatedRewardedVideo(scenario);
        }

        return new Promise((resolve) => {
            this.whenConfigReady(() => {
                const rewardedConfig = this.config.wechatGame.rewarded;
                const adUnitId = this.config.wechatGame.rewardedAdUnitId;
                if (!this.config.enabled || !rewardedConfig.enabled
                    || !this.isAdUnitConfigured(adUnitId, 'rewardedAdUnitId')
                    || rewardedConfig.scenarios[scenario] === false) {
                    resolve(false);
                    return;
                }
                if (this.rewardedInProgress) {
                    console.warn('[AdManager] 已有激励视频正在播放，忽略重复请求');
                    resolve(false);
                    return;
                }

                const ad = this.getWechatRewardedAd(adUnitId);
                if (!ad) {
                    resolve(false);
                    return;
                }

                this.rewardedInProgress = true;
                let settled = false;
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                const finish = (success: boolean): void => {
                    if (settled) return;
                    settled = true;
                    this.rewardedInProgress = false;
                    if (timeoutId !== null) clearTimeout(timeoutId);
                    if (ad.offClose) ad.offClose(onClose);
                    resolve(success);
                };
                const onClose = (result?: RewardedCloseResult): void => {
                    const success = Boolean(result && result.isEnded);
                    console.log(`[AdManager] 激励视频关闭，场景: ${scenario}，完整观看: ${success}`);
                    finish(success);
                };

                ad.onClose(onClose);
                timeoutId = setTimeout(() => {
                    console.warn(`[AdManager] 激励视频超时，场景: ${scenario}`);
                    finish(false);
                }, Math.max(1000, rewardedConfig.loadTimeoutMs));

                this.showWechatAd(ad, `激励视频(${scenario})`).catch(() => finish(false));
            });
        });
    }

    /** 判断下一次是否会展示插屏广告。 */
    public shouldShowInterstitial(force: boolean = false): boolean {
        const interval = Math.max(1, this.config.wechatGame.interstitial.requestInterval);
        return force || ((this.interstitialCount + 1) % interval === 0);
    }

    /** 播放插屏广告；失败不阻塞游戏流程。 */
    public showInterstitial(force: boolean = false): void {
        this.interstitialCount++;
        const interval = Math.max(1, this.config.wechatGame.interstitial.requestInterval);
        if (!force && this.interstitialCount % interval !== 0) return;

        if (!this.isWechatGame()) {
            console.log('[AdManager] 模拟弹出插屏广告');
            return;
        }

        this.whenConfigReady(() => {
            const interstitialConfig = this.config.wechatGame.interstitial;
            const adUnitId = this.config.wechatGame.interstitialAdUnitId;
            if (!this.config.enabled || !interstitialConfig.enabled
                || !this.isAdUnitConfigured(adUnitId, 'interstitialAdUnitId')) return;

            const ad = this.getWechatInterstitialAd(adUnitId);
            if (!ad) return;
            this.showWechatAd(ad, '插屏广告').catch(() => undefined);
        });
    }

    /** 展示底部 Banner 广告。 */
    public showBanner(): void {
        this.bannerWanted = true;
        if (!this.isWechatGame()) {
            if (!this.isBannerShowing) {
                this.isBannerShowing = true;
                console.log('[AdManager] 模拟显示底部 Banner 广告');
            }
            return;
        }
        if (this.isBannerShowing || this.bannerShowPending) return;

        this.bannerShowPending = true;
        this.whenConfigReady(() => {
            this.bannerShowPending = false;
            if (!this.bannerWanted) return;
            const bannerConfig = this.config.wechatGame.banner;
            const adUnitId = this.config.wechatGame.bannerAdUnitId;
            if (!this.config.enabled || !bannerConfig.enabled
                || !this.isAdUnitConfigured(adUnitId, 'bannerAdUnitId')) return;

            const ad = this.getWechatBannerAd(adUnitId);
            if (!ad) return;
            ad.show()
                .then(() => {
                    if (this.bannerWanted) {
                        this.isBannerShowing = true;
                        console.log('[AdManager] 显示底部 Banner 广告');
                    } else {
                        ad.hide();
                    }
                })
                .catch((error: unknown) => {
                    this.isBannerShowing = false;
                    console.warn('[AdManager] Banner 展示失败', error);
                });
        });
    }

    /** 隐藏底部 Banner 广告。 */
    public hideBanner(): void {
        this.bannerWanted = false;
        this.bannerShowPending = false;
        if (!this.isWechatGame()) {
            if (this.isBannerShowing) console.log('[AdManager] 模拟隐藏底部 Banner 广告');
            this.isBannerShowing = false;
            return;
        }

        this.isBannerShowing = false;
        if (this.wechatBannerAd) {
            try {
                this.wechatBannerAd.hide();
            } catch (error) {
                console.warn('[AdManager] Banner 隐藏失败', error);
            }
        }
    }

    private isWechatGame(): boolean {
        return sys.platform === sys.Platform.WECHAT_GAME && typeof wx !== 'undefined';
    }

    private loadConfig(): void {
        if (this.configLoadingStarted) return;
        this.configLoadingStarted = true;
        resources.load('config/ad_config', JsonAsset, (error, asset) => {
            if (error || !asset) {
                console.warn('[AdManager] 广告配置加载失败，使用默认配置：', error);
            } else {
                this.applyConfig(asset.json as AdConfig);
            }
            this.configLoaded = true;
            const callbacks = this.configReadyCallbacks.slice();
            this.configReadyCallbacks.length = 0;
            callbacks.forEach((callback) => callback());
        });
    }

    private whenConfigReady(callback: () => void): void {
        if (this.configLoaded) {
            callback();
        } else {
            this.configReadyCallbacks.push(callback);
        }
    }

    private applyConfig(raw: AdConfig): void {
        const game = raw.wechatGame || {};
        const rawRewarded = game.rewarded || {};
        const rawBanner = game.banner || {};
        const rawInterstitial = game.interstitial || {};
        this.config = {
            enabled: raw.enabled !== false,
            wechatGame: {
                bannerAdUnitId: game.bannerAdUnitId || '',
                rewardedAdUnitId: game.rewardedAdUnitId || '',
                interstitialAdUnitId: game.interstitialAdUnitId || '',
                banner: {
                    enabled: rawBanner.enabled !== false,
                    bottomOffset: Number.isFinite(rawBanner.bottomOffset) ? rawBanner.bottomOffset! : 0,
                },
                rewarded: {
                    enabled: rawRewarded.enabled !== false,
                    loadTimeoutMs: Number.isFinite(rawRewarded.loadTimeoutMs)
                        ? rawRewarded.loadTimeoutMs! : 10000,
                    scenarios: {
                        ...DEFAULT_CONFIG.wechatGame.rewarded.scenarios,
                        ...(rawRewarded.scenarios || {}),
                    },
                },
                interstitial: {
                    enabled: rawInterstitial.enabled !== false,
                    requestInterval: Number.isFinite(rawInterstitial.requestInterval)
                        ? rawInterstitial.requestInterval! : 3,
                },
            },
        };
    }

    private isAdUnitConfigured(adUnitId: string, key: string): boolean {
        const configured = typeof adUnitId === 'string'
            && adUnitId.trim().length > 0
            && !adUnitId.includes('替换')
            && !adUnitId.includes('YOUR_');
        if (!configured && !this.warnedConfigKeys.has(key)) {
            this.warnedConfigKeys.add(key);
            console.warn(`[AdManager] 未配置微信广告位 ID：${key}`);
        }
        return configured;
    }

    private getWechatRewardedAd(adUnitId: string): WechatRewardedVideoAd | null {
        if (this.wechatRewardedAd) return this.wechatRewardedAd;
        try {
            const ad = wx.createRewardedVideoAd({ adUnitId });
            ad.onError((error: unknown) => {
                console.warn('[AdManager] 激励视频错误', error);
            });
            this.wechatRewardedAd = ad;
            return ad;
        } catch (error) {
            console.warn('[AdManager] 激励视频创建失败', error);
            return null;
        }
    }

    private getWechatBannerAd(adUnitId: string): WechatBannerAd | null {
        if (this.wechatBannerAd) return this.wechatBannerAd;
        try {
            const info = wx.getSystemInfoSync();
            const width = Math.min(300, Math.max(280, info.windowWidth - 24));
            const ad = wx.createBannerAd({
                adUnitId,
                style: {
                    left: (info.windowWidth - width) / 2,
                    top: Math.max(0, info.windowHeight - 100),
                    width,
                },
            });
            ad.onError((error: unknown) => {
                console.warn('[AdManager] Banner 错误', error);
            });
            ad.onResize?.((size) => {
                const currentInfo = wx.getSystemInfoSync();
                ad.style.left = (currentInfo.windowWidth - size.width) / 2;
                ad.style.top = Math.max(
                    0,
                    currentInfo.windowHeight - size.height
                    - this.config.wechatGame.banner.bottomOffset,
                );
            });
            this.wechatBannerAd = ad;
            return ad;
        } catch (error) {
            console.warn('[AdManager] Banner 创建失败', error);
            return null;
        }
    }

    private getWechatInterstitialAd(adUnitId: string): WechatInterstitialAd | null {
        if (this.wechatInterstitialAd) return this.wechatInterstitialAd;
        try {
            const ad = wx.createInterstitialAd({ adUnitId });
            ad.onError((error: unknown) => {
                console.warn('[AdManager] 插屏错误', error);
            });
            this.wechatInterstitialAd = ad;
            return ad;
        } catch (error) {
            console.warn('[AdManager] 插屏创建失败', error);
            return null;
        }
    }

    private showWechatAd(ad: { show(): Promise<void>; load(): Promise<void> }, name: string): Promise<void> {
        return ad.show().catch((showError: unknown) => {
            console.warn(`[AdManager] ${name}首次展示失败，尝试重新加载`, showError);
            return ad.load().then(() => ad.show());
        }).catch((error: unknown) => {
            console.warn(`[AdManager] ${name}加载或展示失败`, error);
            return Promise.reject(error);
        });
    }

    private showSimulatedRewardedVideo(scenario: string): Promise<boolean> {
        return new Promise((resolve) => {
            console.log(`[AdManager] 模拟请求播放激励视频，场景: ${scenario}`);
            setTimeout(() => {
                console.log(`[AdManager] 模拟激励视频观看完毕 (${scenario})`);
                resolve(true);
            }, 1000);
        });
    }
}
