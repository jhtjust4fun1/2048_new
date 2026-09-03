/**
 * SkinManager.ts
 * 皮肤配置与金币/皮肤数据持久化管理服务。
 */

import { sys, Color } from 'cc';
import { Difficulty, DIFFICULTY_CONFIGS } from './BoardLogic';

export interface TileColorStyle {
    bg: Color;
    text: Color;
}

export interface SkinConfig {
    id: string;                    // 唯一标识
    name: string;                  // 显示名称
    price: number;                 // 金币售价
    description: string;           // 描述
    boardBg: Color;                // 棋盘背景色
    cellBg: Color;                 // 空格子背景色
    resName?: string;              // 对应 resources/skin 下的 PNG 图片资源名称
    colors: TileColorStyle[];      // 各数值方块样式 (2, 4, 8, 16 ... 4096+)
}

/** 默认预置的皮肤配置列表 */
export const SKIN_CONFIGS: SkinConfig[] = [
    {
        id: 'classic',
        name: '经典原木',
        price: 0,
        description: '温馨自然的经典原木风质感格子',
        boardBg: new Color(187, 173, 160),
        cellBg: new Color(205, 193, 180),
        resName: 'classic_wood',
        colors: [
            { bg: new Color(238, 228, 218), text: new Color(119, 110, 101) }, // 2
            { bg: new Color(237, 224, 200), text: new Color(119, 110, 101) }, // 4
            { bg: new Color(242, 177, 121), text: new Color(249, 246, 242) }, // 8
            { bg: new Color(245, 149, 99), text: new Color(249, 246, 242) },  // 16
            { bg: new Color(246, 124, 95), text: new Color(249, 246, 242) },  // 32
            { bg: new Color(246, 94, 59), text: new Color(249, 246, 242) },   // 64
            { bg: new Color(237, 207, 114), text: new Color(249, 246, 242) }, // 128
            { bg: new Color(237, 204, 97), text: new Color(249, 246, 242) },  // 256
            { bg: new Color(237, 200, 80), text: new Color(249, 246, 242) },  // 512
            { bg: new Color(237, 197, 63), text: new Color(249, 246, 242) },  // 1024
            { bg: new Color(237, 194, 46), text: new Color(249, 246, 242) },  // 2048
            { bg: new Color(60, 58, 50), text: new Color(249, 246, 242) },    // 4096+
        ],
    },
    {
        id: 'neon',
        name: '赛博霓虹',
        price: 300,
        description: '充满科幻感的炫酷赛博发光线框',
        boardBg: new Color(30, 30, 46),
        cellBg: new Color(45, 45, 68),
        resName: 'cyber_neon',
        colors: [
            { bg: new Color(68, 71, 90), text: new Color(248, 248, 242) },    // 2
            { bg: new Color(98, 114, 164), text: new Color(248, 248, 242) },  // 4
            { bg: new Color(139, 233, 253), text: new Color(40, 42, 54) },    // 8
            { bg: new Color(80, 250, 123), text: new Color(40, 42, 54) },    // 16
            { bg: new Color(255, 184, 108), text: new Color(40, 42, 54) },   // 32
            { bg: new Color(255, 121, 198), text: new Color(248, 248, 242) },  // 64
            { bg: new Color(189, 147, 249), text: new Color(248, 248, 242) },  // 128
            { bg: new Color(255, 85, 85), text: new Color(248, 248, 242) },   // 256
            { bg: new Color(241, 250, 140), text: new Color(40, 42, 54) },   // 512
            { bg: new Color(0, 230, 204), text: new Color(40, 42, 54) },     // 1024
            { bg: new Color(255, 0, 128), text: new Color(248, 248, 242) },   // 2048
            { bg: new Color(138, 43, 226), text: new Color(248, 248, 242) },  // 4096+
        ],
    },
    {
        id: 'dark',
        name: '像素复古',
        price: 600,
        description: '复古 8-Bit 像素立性质感方块',
        boardBg: new Color(24, 24, 24),
        cellBg: new Color(38, 38, 38),
        resName: 'retro_8bit',
        colors: [
            { bg: new Color(55, 55, 55), text: new Color(220, 220, 220) },    // 2
            { bg: new Color(75, 75, 75), text: new Color(240, 240, 240) },    // 4
            { bg: new Color(100, 100, 100), text: new Color(255, 255, 255) },  // 8
            { bg: new Color(130, 130, 130), text: new Color(255, 255, 255) },  // 16
            { bg: new Color(160, 160, 160), text: new Color(20, 20, 20) },    // 32
            { bg: new Color(190, 190, 190), text: new Color(20, 20, 20) },    // 64
            { bg: new Color(220, 220, 220), text: new Color(20, 20, 20) },    // 128
            { bg: new Color(240, 240, 100), text: new Color(20, 20, 20) },    // 256
            { bg: new Color(250, 200, 60), text: new Color(20, 20, 20) },     // 512
            { bg: new Color(255, 160, 40), text: new Color(255, 255, 255) },  // 1024
            { bg: new Color(255, 100, 40), text: new Color(255, 255, 255) },  // 2048
            { bg: new Color(230, 40, 40), text: new Color(255, 255, 255) },   // 4096+
        ],
    },
    {
        id: 'macaron',
        name: '重工警示',
        price: 1000,
        description: '硬核工业斜纹警示扣件方块',
        boardBg: new Color(225, 215, 205),
        cellBg: new Color(238, 230, 222),
        resName: 'hazard_industrial',
        colors: [
            { bg: new Color(245, 223, 218), text: new Color(105, 90, 85) },   // 2
            { bg: new Color(253, 238, 212), text: new Color(105, 90, 85) },   // 4
            { bg: new Color(221, 235, 215), text: new Color(75, 95, 80) },    // 8
            { bg: new Color(212, 232, 237), text: new Color(70, 90, 100) },   // 16
            { bg: new Color(228, 219, 237), text: new Color(90, 80, 100) },   // 32
            { bg: new Color(248, 210, 222), text: new Color(110, 75, 85) },   // 64
            { bg: new Color(255, 220, 180), text: new Color(110, 85, 60) },   // 128
            { bg: new Color(200, 230, 200), text: new Color(60, 90, 60) },    // 256
            { bg: new Color(180, 220, 240), text: new Color(50, 80, 110) },   // 512
            { bg: new Color(220, 200, 240), text: new Color(80, 60, 110) },   // 1024
            { bg: new Color(255, 190, 210), text: new Color(110, 60, 80) },   // 2048
            { bg: new Color(255, 215, 0), text: new Color(100, 80, 20) },     // 4096+
        ],
    },
];

const KEY_COINS = '2048_total_coins';
const KEY_UNLOCKED = '2048_unlocked_skins';
const KEY_EQUIPPED = '2048_equipped_skin';

export class SkinManager {
    private static _instance: SkinManager;

    public static get instance(): SkinManager {
        if (!this._instance) {
            this._instance = new SkinManager();
        }
        return this._instance;
    }

    private coins = 0;
    private unlockedSkins: Set<string> = new Set(['classic']);
    private equippedSkinId = 'classic';
    private adWatchedProgress: Map<string, number> = new Map();

    private constructor() {
        this.loadData();
    }

    private loadData(): void {
        // 加载金币
        const savedCoins = sys.localStorage.getItem(KEY_COINS);
        this.coins = savedCoins ? Math.max(0, parseInt(savedCoins, 10) || 0) : 0;
        this.coins = 9999999; // 【开发测试】强制给满金币

        // 加载已解锁皮肤
        const savedUnlocked = sys.localStorage.getItem(KEY_UNLOCKED);
        if (savedUnlocked) {
            try {
                const list = JSON.parse(savedUnlocked);
                if (Array.isArray(list)) {
                    list.forEach((id) => this.unlockedSkins.add(id));
                }
            } catch (e) {
                this.unlockedSkins.add('classic');
            }
        } else {
            this.unlockedSkins.add('classic');
        }

        // 加载当前装备的皮肤
        const savedEquipped = sys.localStorage.getItem(KEY_EQUIPPED);
        if (savedEquipped && this.getSkinConfig(savedEquipped)) {
            this.equippedSkinId = savedEquipped;
        } else {
            this.equippedSkinId = 'classic';
        }

        // 加载广告解锁进度
        const savedAdProgress = sys.localStorage.getItem('2048_ad_progress');
        if (savedAdProgress) {
            try {
                const progressObj = JSON.parse(savedAdProgress);
                for (const key in progressObj) {
                    this.adWatchedProgress.set(key, progressObj[key]);
                }
            } catch (e) {}
        }
    }

    // ==================== 金币管理 ====================

    public getCoins(): number {
        return this.coins;
    }

    /**
     * 根据增加的分数及难度换算增加金币
     * @returns 本次获得的金币数
     */
    public addCoinsFromScore(scoreGained: number, difficulty: Difficulty): number {
        if (scoreGained <= 0) return 0;
        const config = DIFFICULTY_CONFIGS[difficulty];
        const rate = config ? config.coinRate : 100;
        const gainedCoins = Math.floor(scoreGained / rate);
        if (gainedCoins > 0) {
            this.coins += gainedCoins;
            sys.localStorage.setItem(KEY_COINS, String(this.coins));
        }
        return gainedCoins;
    }

    public addCoins(amount: number): void {
        if (amount <= 0) return;
        this.coins += amount;
        sys.localStorage.setItem(KEY_COINS, String(this.coins));
    }

    /**
     * 扣减金币，返回是否成功。用于称号抽卡等金币消耗场景。
     */
    public spendCoins(amount: number): boolean {
        if (amount <= 0) return false;
        if (this.coins < amount) return false;
        this.coins -= amount;
        sys.localStorage.setItem(KEY_COINS, String(this.coins));
        return true;
    }

    // ==================== 皮肤管理 ====================

    public getEquippedSkinId(): string {
        return this.equippedSkinId;
    }

    public getEquippedSkin(): SkinConfig {
        return this.getSkinConfig(this.equippedSkinId) || SKIN_CONFIGS[0];
    }

    public isSkinUnlocked(skinId: string): boolean {
        return this.unlockedSkins.has(skinId);
    }

    public getSkinConfig(skinId: string): SkinConfig | null {
        return SKIN_CONFIGS.find((s) => s.id === skinId) || null;
    }

    /**
     * 购买皮肤
     */
    public buySkin(skinId: string): boolean {
        const config = this.getSkinConfig(skinId);
        if (!config) return false;
        if (this.isSkinUnlocked(skinId)) return true;
        if (this.coins < config.price) return false;

        this.coins -= config.price;
        this.unlockSkinInternal(skinId);
        return true;
    }

    private unlockSkinInternal(skinId: string): void {
        this.unlockedSkins.add(skinId);
        sys.localStorage.setItem(KEY_COINS, String(this.coins));
        sys.localStorage.setItem(KEY_UNLOCKED, JSON.stringify(Array.from(this.unlockedSkins)));
        // 自动装备新买的皮肤
        this.equipSkin(skinId);
    }

    // ==================== 广告解锁 ====================

    public getAdWatchedCount(skinId: string): number {
        return this.adWatchedProgress.get(skinId) || 0;
    }

    public watchAdForSkin(skinId: string): boolean {
        if (this.isSkinUnlocked(skinId)) return true;
        
        const currentCount = this.getAdWatchedCount(skinId) + 1;
        this.adWatchedProgress.set(skinId, currentCount);
        
        // 保存进度
        const progressObj: any = {};
        this.adWatchedProgress.forEach((val, key) => progressObj[key] = val);
        sys.localStorage.setItem('2048_ad_progress', JSON.stringify(progressObj));

        if (currentCount >= 5) {
            this.unlockSkinInternal(skinId);
            return true; // 已解锁
        }
        return false; // 还未解锁
    }

    /**
     * 装备皮肤
     */
    public equipSkin(skinId: string): boolean {
        if (!this.isSkinUnlocked(skinId)) return false;
        this.equippedSkinId = skinId;
        sys.localStorage.setItem(KEY_EQUIPPED, skinId);
        return true;
    }

    /**
     * 获取指定数值在当前皮肤下的颜色样式
     */
    public getTileStyle(value: number): TileColorStyle {
        const skin = this.getEquippedSkin();
        const idx = Math.min(Math.floor(Math.log2(value)) - 1, skin.colors.length - 1);
        return skin.colors[idx >= 0 ? idx : 0];
    }
}
