/**
 * TitleManager.ts
 * 称号系统：抽卡、背包、装备、SSR→UR 合成、每日广告次数与数据持久化。
 * 数据源：assets/resources/config/title_config.json（称号配置表，支持扩展）。
 */

import { sys, resources, JsonAsset } from 'cc';
import { SkinManager } from './SkinManager';

/** Buff 类型（与设计文档第五节枚举保持一致） */
export enum BuffType {
    COIN_BONUS = 1,      // 金币加成
    SCORE_BONUS = 2,     // 分数加成
    BOMB_PROB = 3,       // 炸弹出现概率
    BOMB_RANGE = 4,      // 爆炸范围扩大
    BOMB_SCORE_MULT = 5, // 被炸毁方块得分翻倍
    BOMB_NO_DESTROY = 6, // 爆炸 10% 不毁方块只加分
    // === SSR/UR 专属复合机制 ===
    COMBO_GOLD_BONUS = 7,      // 连击≥3时每步额外奖励金币
    MERGE_GOLD_DROP = 8,       // 合成时金币掉落概率
    GRAVITY_MERGE = 9,         // 引力吸入（最小同值块合并）
    UNDO_COUNT = 10,           // 免费撤销次数
    INITIAL_BOOST = 11,        // 开局升格（值=1启用）
    CHAIN_EXPLOSION = 12,      // 十字追击冲击波
    CLEAR_SMALL_TILES = 13,    // 清屏≤N方块
    PAUSE_SPAWN = 14,          // 空格不足时不生成（值=可用次数）
    ABSOLUTE_DOMAIN = 15,      // 奇数位同化（值=可用次数）
    MIN_SPAWN_VALUE = 16,      // 保底生成值
    SPAWN_8_PROB = 17,         // 生成8额外概率
    WIN_2048_REWARD = 18,      // 2048通关返利金币数
    COMBO_SCORE_MULT = 19,     // 连击得分额外倍率
    GAME_OVER_PREVENT = 20,    // 卡死回溯（值=本局可用次数）
}

/** 单个 Buff 效果（类型 + 数值） */
export interface BuffEffect {
    type: BuffType;
    value: number;
}

export type TitleRarity = 'N' | 'R' | 'SR' | 'SSR' | 'UR';

export interface TitleConfig {
    id: string;
    name: string;
    rarity: TitleRarity;
    /** 抽卡权重（UR 不进入抽卡池，weight 为 0） */
    weight: number;
    /** 主效果类型（兼容旧格式单 buff；复合效果请同时使用 effects） */
    buffType: BuffType;
    buffValue: number;
    /** 复合效果列表：主效果 + 附加效果（可空） */
    effects: BuffEffect[];
    desc: string;
    /** 仅 SSR：合成对应 UR 的称号 ID */
    evolveTargetId?: string;
}

/** 稀有度显示色 */
export const RARITY_COLORS: Record<TitleRarity, string> = {
    N: '#9e9e9e',
    R: '#4a90d9',
    SR: '#9b59d0',
    SSR: '#f2b30f',
    UR: '#e34a4a',
};

/** 将单个 Buff 类型与数值格式化为可读文本（用于图鉴/介绍展示） */
export function formatBuffText(buffType: BuffType, buffValue: number): string {
    switch (buffType) {
        case BuffType.COIN_BONUS:
            return `结算金币 +${Math.round(buffValue * 100)}%`;
        case BuffType.SCORE_BONUS:
            return `结算分数 +${Math.round(buffValue * 100)}%`;
        case BuffType.BOMB_PROB:
            return `炸弹出现概率 +${(buffValue * 100).toFixed(1)}%`;
        case BuffType.BOMB_RANGE:
            return `爆炸范围扩大 ${buffValue} 格`;
        case BuffType.BOMB_SCORE_MULT:
            return `被炸方块分数 ${buffValue} 倍`;
        case BuffType.BOMB_NO_DESTROY:
            return `爆炸 ${Math.round(buffValue * 100)}% 不毁方块只加分`;
        case BuffType.COMBO_GOLD_BONUS:
            return `3 连击以上每步 +${Math.round(buffValue)} 金币`;
        case BuffType.MERGE_GOLD_DROP:
            return `合成 ${Math.round(buffValue * 100)}% 概率掉落金币`;
        case BuffType.GRAVITY_MERGE:
            return `爆炸后引力吸入最小同值方块合并`;
        case BuffType.UNDO_COUNT:
            return `每局 ${Math.round(buffValue)} 次免费撤销`;
        case BuffType.INITIAL_BOOST:
            return `开局随机两格直升为 16`;
        case BuffType.CHAIN_EXPLOSION:
            return `波及同值方块时追加十字冲击波`;
        case BuffType.CLEAR_SMALL_TILES:
            return `爆炸触发连环爆破，清屏所有 ≤${Math.round(buffValue)} 方块`;
        case BuffType.PAUSE_SPAWN:
            return `空格不足时停止生成（每局 ${Math.round(buffValue)} 次）`;
        case BuffType.ABSOLUTE_DOMAIN:
            return `空间不足时激活绝对领域，奇数位同化（每局 ${Math.round(buffValue)} 次）`;
        case BuffType.MIN_SPAWN_VALUE:
            return `新方块保底为 ${Math.round(buffValue)}`;
        case BuffType.SPAWN_8_PROB:
            return `生成 8 概率 +${Math.round(buffValue * 100)}%`;
        case BuffType.WIN_2048_REWARD:
            return `合成 2048 触发通关奖励并返还 ${Math.round(buffValue)} 金币`;
        case BuffType.COMBO_SCORE_MULT:
            return `连击得分额外 ${buffValue} 倍`;
        case BuffType.GAME_OVER_PREVENT:
            return `卡死濒死时自动回溯清杂（每局 ${Math.round(buffValue)} 次）`;
        default:
            return '';
    }
}

/** 将称号的全部效果（主效果 + 附加效果）格式化为可读文本 */
export function formatAllEffects(cfg: TitleConfig): string {
    const parts = [formatBuffText(cfg.buffType, cfg.buffValue)];
    for (const e of cfg.effects) {
        parts.push(formatBuffText(e.type, e.value));
    }
    return parts.filter((s) => s.length > 0).join('，');
}

const KEY_INVENTORY = '2048_title_inventory';
const KEY_EQUIPPED = '2048_equipped_title';
const KEY_FREE_AD_DATE = '2048_title_free_ad_date';
const KEY_FREE_AD_COUNT = '2048_title_free_ad_count';

/** 模块级称号配置缓存（由 JSON 加载后填充） */
let titleConfigs: TitleConfig[] = [];

function todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 将 JSON 中的 buffType 字符串映射为枚举值 */
function parseBuffType(str: string): BuffType {
    const map: Record<string, BuffType> = {
        'COIN_BONUS': BuffType.COIN_BONUS,
        'SCORE_BONUS': BuffType.SCORE_BONUS,
        'BOMB_PROB': BuffType.BOMB_PROB,
        'BOMB_RANGE': BuffType.BOMB_RANGE,
        'BOMB_SCORE_MULT': BuffType.BOMB_SCORE_MULT,
        'BOMB_NO_DESTROY': BuffType.BOMB_NO_DESTROY,
        'COMBO_GOLD_BONUS': BuffType.COMBO_GOLD_BONUS,
        'MERGE_GOLD_DROP': BuffType.MERGE_GOLD_DROP,
        'GRAVITY_MERGE': BuffType.GRAVITY_MERGE,
        'UNDO_COUNT': BuffType.UNDO_COUNT,
        'INITIAL_BOOST': BuffType.INITIAL_BOOST,
        'CHAIN_EXPLOSION': BuffType.CHAIN_EXPLOSION,
        'CLEAR_SMALL_TILES': BuffType.CLEAR_SMALL_TILES,
        'PAUSE_SPAWN': BuffType.PAUSE_SPAWN,
        'ABSOLUTE_DOMAIN': BuffType.ABSOLUTE_DOMAIN,
        'MIN_SPAWN_VALUE': BuffType.MIN_SPAWN_VALUE,
        'SPAWN_8_PROB': BuffType.SPAWN_8_PROB,
        'WIN_2048_REWARD': BuffType.WIN_2048_REWARD,
        'COMBO_SCORE_MULT': BuffType.COMBO_SCORE_MULT,
        'GAME_OVER_PREVENT': BuffType.GAME_OVER_PREVENT,
    };
    return map[str] ?? BuffType.COIN_BONUS;
}

/** 将原始 JSON 条目解析为 TitleConfig */
function parseTitleConfig(raw: any): TitleConfig {
    const effects: BuffEffect[] = [];
    if (Array.isArray(raw.effects)) {
        for (const e of raw.effects) {
            effects.push({ type: parseBuffType(e.type), value: e.value ?? 0 });
        }
    }
    return {
        id: raw.id,
        name: raw.name,
        rarity: raw.rarity as TitleRarity,
        weight: raw.weight ?? 0,
        buffType: parseBuffType(raw.buffType),
        buffValue: raw.buffValue ?? 0,
        effects,
        desc: raw.desc ?? '',
        evolveTargetId: raw.evolveTargetId,
    };
}

export class TitleManager {
    private static _instance: TitleManager;

    public static get instance(): TitleManager {
        if (!this._instance) {
            this._instance = new TitleManager();
        }
        return this._instance;
    }

    // ============ 运行时配置值（从 JSON 加载，有默认兜底） ============

    private _gachaPrice = 200;
    private _gachaTenCount = 10;
    private _dailyFreeAdLimit = 5;
    /** SSR 独立命中率（先于权重池判定，默认 1%） */
    private _gachaSsrRate = 0.01;
    /** 金币付费抽（单抽/十连）的空抽率，默认 20%；广告免费抽不受影响 */
    private _gachaMissRate = 0.2;

    /** 单次抽卡价格（金币），来自配置文件 */
    public get gachaPrice(): number { return this._gachaPrice; }
    /** 十连抽数量 */
    public get gachaTenCount(): number { return this._gachaTenCount; }
    /** 每日广告免费抽次数上限 */
    public get dailyFreeAdLimit(): number { return this._dailyFreeAdLimit; }
    /** SSR 独立命中率 */
    public get gachaSsrRate(): number { return this._gachaSsrRate; }
    /** 金币付费抽空抽率 */
    public get gachaMissRate(): number { return this._gachaMissRate; }

    /** 返回所有称号配置（拷贝，外部修改不影响内部） */
    public getAllConfigs(): TitleConfig[] {
        return [...titleConfigs];
    }

    // ============ 运行时状态 ============

    /** 背包：称号 ID -> 拥有数量 */
    private inventory: Record<string, number> = {};
    private equippedTitleId: string | null = null;
    /** 还未验证的装备 ID（配置加载前暂存） */
    private pendingEquippedId: string | null = null;
    /** 当日已使用广告免费抽次数（跨日自动重置） */
    private freeAdDate = '';
    private freeAdCount = 0;

    private configLoaded = false;
    private loadingStarted = false;
    private readyCallbacks: (() => void)[] = [];

    private constructor() {
        this.loadData();
        this.ensureLoadOnce();
    }

    /** 注册配置就绪回调，若已就绪则立即执行 */
    public whenReady(cb: () => void): void {
        if (this.configLoaded) {
            cb();
        } else {
            this.readyCallbacks.push(cb);
        }
    }

    /** 是否已就绪 */
    public get isConfigReady(): boolean {
        return this.configLoaded;
    }

    /** 加载配置（若尚未加载），供外部提前预热 */
    public ensureLoadOnce(): void {
        if (this.loadingStarted) return;
        this.loadingStarted = true;

        resources.load('config/title_config', JsonAsset, (err, asset) => {
            if (err) {
                console.warn('[TitleManager] 称号配置加载失败，使用默认值：', err);
                // titleConfigs 保持空数组，gacha 数值使用默认值
            } else {
                const data = asset.json as any;
                if (typeof data.gachaPrice === 'number') this._gachaPrice = data.gachaPrice;
                if (typeof data.gachaTenCount === 'number') this._gachaTenCount = data.gachaTenCount;
                if (typeof data.dailyFreeAdLimit === 'number') this._dailyFreeAdLimit = data.dailyFreeAdLimit;
                if (typeof data.gachaSsrRate === 'number') this._gachaSsrRate = data.gachaSsrRate;
                if (typeof data.gachaMissRate === 'number') this._gachaMissRate = data.gachaMissRate;
                if (data.titles && Array.isArray(data.titles)) {
                    titleConfigs = data.titles.map((t: any) => parseTitleConfig(t));
                }
            }
            this.configLoaded = true;
            this.validateEquipped();
            // 触发就绪回调
            const cbs = this.readyCallbacks.slice();
            this.readyCallbacks.length = 0;
            cbs.forEach((cb) => cb());
        });
    }

    // ============ 持久化 ============

    private loadData(): void {
        const saved = sys.localStorage.getItem(KEY_INVENTORY);
        if (saved) {
            try {
                const obj = JSON.parse(saved);
                if (obj && typeof obj === 'object') {
                    this.inventory = obj;
                }
            } catch (e) {}
        }

        // 暂存装备 ID，延迟到配置加载后验证
        const equipped = sys.localStorage.getItem(KEY_EQUIPPED);
        this.pendingEquippedId = equipped || null;

        // 如果配置已加载（如 JSON 加载比构造快），立即验证
        if (this.configLoaded) {
            this.validateEquipped();
        }

        this.freeAdDate = sys.localStorage.getItem(KEY_FREE_AD_DATE) || '';
        const countStr = sys.localStorage.getItem(KEY_FREE_AD_COUNT);
        this.freeAdCount = countStr ? parseInt(countStr, 10) || 0 : 0;
        if (this.freeAdDate !== todayKey()) {
            this.freeAdDate = todayKey();
            this.freeAdCount = 0;
            this.saveFreeAdState();
        }
    }

    /** 配置加载后验证装备 ID 是否有效，无效则清除 */
    private validateEquipped(): void {
        if (!this.pendingEquippedId) return;
        if (this.getTitleConfig(this.pendingEquippedId)) {
            this.equippedTitleId = this.pendingEquippedId;
            sys.localStorage.setItem(KEY_EQUIPPED, this.pendingEquippedId);
        } else {
            this.equippedTitleId = null;
            sys.localStorage.removeItem(KEY_EQUIPPED);
        }
        this.pendingEquippedId = null;
    }

    private saveInventory(): void {
        sys.localStorage.setItem(KEY_INVENTORY, JSON.stringify(this.inventory));
    }

    private saveFreeAdState(): void {
        sys.localStorage.setItem(KEY_FREE_AD_DATE, this.freeAdDate);
        sys.localStorage.setItem(KEY_FREE_AD_COUNT, String(this.freeAdCount));
    }

    // ==================== 查询 ====================

    public getTitleConfig(id: string): TitleConfig | null {
        return titleConfigs.find((t) => t.id === id) || null;
    }

    /** 背包中所有称号（含数量） */
    public getInventory(): { config: TitleConfig; count: number }[] {
        const result: { config: TitleConfig; count: number }[] = [];
        for (const id in this.inventory) {
            const config = this.getTitleConfig(id);
            if (config) result.push({ config, count: this.inventory[id] });
        }
        return result;
    }

    public getOwnedCount(id: string): number {
        return this.inventory[id] || 0;
    }

    public getEquippedTitleId(): string | null {
        return this.equippedTitleId;
    }

    public getEquippedTitle(): TitleConfig | null {
        return this.equippedTitleId ? this.getTitleConfig(this.equippedTitleId) : null;
    }

    public getFreeAdLeftToday(): number {
        const used = this.freeAdDate === todayKey() ? this.freeAdCount : 0;
        return Math.max(0, this.dailyFreeAdLimit - used);
    }

    // ==================== 装备 ====================

    public equipTitle(id: string): boolean {
        if (this.getOwnedCount(id) <= 0) return false;
        this.equippedTitleId = id;
        sys.localStorage.setItem(KEY_EQUIPPED, id);
        return true;
    }

    // ==================== 金币（复用 SkinManager 存档） ====================

    public getCoins(): number {
        return SkinManager.instance.getCoins();
    }

    public addCoins(amount: number): void {
        SkinManager.instance.addCoins(amount);
    }

    public spendCoins(amount: number): boolean {
        return SkinManager.instance.spendCoins(amount);
    }

    // ==================== 抽卡 ====================

    /** 从指定权重池中按权重抽取一个称号 ID，池为空返回空字符串 */
    private rollFromPool(pool: TitleConfig[]): string {
        if (pool.length === 0) return '';
        const totalWeight = pool.reduce((sum, t) => sum + t.weight, 0);
        let rand = Math.random() * totalWeight;
        for (const t of pool) {
            rand -= t.weight;
            if (rand <= 0) return t.id;
        }
        return pool[pool.length - 1].id;
    }

    /**
     * 抽取一个称号（不含 UR）。
     * 概率规则：
     *  - SSR 独立命中率固定为 gachaSsrRate（1%），命中后在 SSR 池内按权重选一；
     *  - withMiss 为 true（金币单抽/十连）时，每抽先有 gachaMissRate（20%）概率空抽返回 ''；
     *  - 其余概率由 N/R/SR 按各自 weight 相对共享（SSR 不参与权重池）。
     */
    public rollTitle(withMiss = false): string {
        const ssrPool = titleConfigs.filter((t) => t.rarity === 'SSR' && t.weight > 0);
        const normalPool = titleConfigs.filter((t) => t.rarity !== 'SSR' && t.weight > 0);
        if (ssrPool.length === 0 && normalPool.length === 0) return '';

        const missRate = withMiss ? this._gachaMissRate : 0;
        const r = Math.random();
        if (r < missRate) return '';                                          // 空抽（仅金币付费抽）
        if (r < missRate + this._gachaSsrRate) return this.rollFromPool(ssrPool); // SSR 独立 1%
        return this.rollFromPool(normalPool);                                 // N/R/SR 分享剩余概率
    }

    /** 单次抽卡（金币），金币不足或抽空返回 null（抽空时金币不退回） */
    public gachaOnce(): TitleConfig | null {
        if (!this.spendCoins(this.gachaPrice)) return null;
        const id = this.rollTitle(true);
        if (!id) return null;
        return this.grantTitle(id);
    }

    /** 观看广告免费单抽（每日限 dailyFreeAdLimit 次，无空抽），失败返回 null */
    public gachaFreeAd(): TitleConfig | null {
        if (this.getFreeAdLeftToday() <= 0) return null;
        this.freeAdCount += 1;
        this.saveFreeAdState();
        const id = this.rollTitle(false);
        if (!id) return null;
        return this.grantTitle(id);
    }

    /** 十连抽：广告半价。返回本次获得的所有称号（可为空数组表示金币不足）。 */
    public gachaTen(adDiscount: boolean): TitleConfig[] {
        const cost = adDiscount
            ? Math.floor(this.gachaPrice * this.gachaTenCount / 2)
            : this.gachaPrice * this.gachaTenCount;
        if (!this.spendCoins(cost)) return [];
        const gained: TitleConfig[] = [];
        for (let i = 0; i < this.gachaTenCount; i++) {
            const id = this.rollTitle(true);
            if (!id) continue;
            gained.push(this.grantTitle(id));
        }
        return gained;
    }

    /** 发放入背包，返回称号配置 */
    public grantTitle(id: string): TitleConfig {
        this.inventory[id] = (this.inventory[id] || 0) + 1;
        this.saveInventory();
        return this.getTitleConfig(id)!;
    }

    // ==================== 合成（3 同名 SSR → 专属 UR） ====================

    /** 检查指定 SSR 是否可合成 */
    public canAscend(ssrId: string): boolean {
        const cfg = this.getTitleConfig(ssrId);
        if (!cfg || cfg.rarity !== 'SSR' || !cfg.evolveTargetId) return false;
        return this.getOwnedCount(ssrId) >= 3;
    }

    /** 执行合成：3 个同名 SSR → 1 个专属 UR，成功返回 UR 配置，失败返回 null */
    public ascend(ssrId: string): TitleConfig | null {
        const cfg = this.getTitleConfig(ssrId);
        if (!cfg || !this.canAscend(ssrId)) return null;
        const urConfig = this.getTitleConfig(cfg.evolveTargetId!);
        if (!urConfig) return null;

        this.inventory[ssrId] -= 3;
        if (this.inventory[ssrId] <= 0) delete this.inventory[ssrId];
        this.inventory[urConfig.id] = (this.inventory[urConfig.id] || 0) + 1;
        this.saveInventory();
        return urConfig;
    }
}