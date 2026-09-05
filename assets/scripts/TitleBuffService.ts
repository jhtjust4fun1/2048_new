import { BoardBuffs, MoveResult } from './BoardLogic';
import { BuffType, formatBuffText, TitleManager } from './TitleManager';

export interface TriggeredBuffState {
    lastBombProbTriggered: boolean;
    lastSpawn8Triggered: boolean;
}

/** 集中处理装备称号到棋盘 Buff 的映射，避免游戏流程直接依赖称号配置细节。 */
export class TitleBuffService {
    public getEffects(): { type: BuffType; value: number }[] {
        const title = TitleManager.instance.getEquippedTitle();
        if (!title) return [];
        return [{ type: title.buffType, value: title.buffValue }, ...(title.effects || [])];
    }

    public getBoardBuffs(): BoardBuffs {
        const buffs: BoardBuffs = {};
        for (const effect of this.getEffects()) {
            switch (effect.type) {
                case BuffType.SCORE_BONUS: buffs.scoreMultiplier = 1 + effect.value; break;
                case BuffType.BOMB_PROB: buffs.bombProb = effect.value; break;
                case BuffType.BOMB_RANGE: buffs.bombRangeExtra = effect.value; break;
                case BuffType.BOMB_SCORE_MULT: buffs.bombScoreMultiplier = effect.value; break;
                case BuffType.BOMB_NO_DESTROY: buffs.bombNoDestroyProb = effect.value; break;
                case BuffType.COMBO_GOLD_BONUS: buffs.comboGoldBonus = effect.value; break;
                case BuffType.MERGE_GOLD_DROP: buffs.mergeGoldDropProb = effect.value; break;
                case BuffType.GRAVITY_MERGE: buffs.gravityMerge = effect.value > 0; break;
                case BuffType.UNDO_COUNT: buffs.undoCount = effect.value; break;
                case BuffType.INITIAL_BOOST: buffs.initialBoost = effect.value > 0; break;
                case BuffType.CHAIN_EXPLOSION: buffs.chainExplosion = effect.value > 0; break;
                case BuffType.CLEAR_SMALL_TILES: buffs.clearSmallThreshold = effect.value; break;
                case BuffType.PAUSE_SPAWN: buffs.pauseSpawnUses = effect.value; break;
                case BuffType.ABSOLUTE_DOMAIN: buffs.absoluteDomainUses = effect.value; break;
                case BuffType.MIN_SPAWN_VALUE: buffs.minSpawnValue = effect.value; break;
                case BuffType.SPAWN_8_PROB: buffs.spawn8Prob = effect.value; break;
                case BuffType.WIN_2048_REWARD: buffs.win2048Reward = effect.value; break;
                case BuffType.COMBO_SCORE_MULT: buffs.comboScoreMultiplier = effect.value; break;
                case BuffType.GAME_OVER_PREVENT: buffs.gameOverPreventUses = effect.value; break;
                default: break;
            }
        }
        return buffs;
    }

    public has(type: BuffType): boolean {
        return this.getEffects().some((effect) => effect.type === type && effect.value > 0);
    }

    public getValue(type: BuffType): number {
        return this.getEffects().find((effect) => effect.type === type)?.value || 0;
    }

    public getCoinMultiplier(): number {
        return 1 + this.getEffects()
            .filter((effect) => effect.type === BuffType.COIN_BONUS)
            .reduce((sum, effect) => sum + effect.value, 0);
    }

    public getTriggeredTips(result: MoveResult, state: TriggeredBuffState, hasSpawnedPosition: boolean): string[] {
        const title = TitleManager.instance.getEquippedTitle();
        if (!title) return [];
        const tips: string[] = [];
        const add = (type: BuffType, suffix = ''): void => {
            if (!this.has(type)) return;
            const text = formatBuffText(type, this.getValue(type));
            if (text) tips.push(`${text}${suffix}`);
        };
        if (result.combo > 0) {
            add(BuffType.SCORE_BONUS);
            add(BuffType.COMBO_SCORE_MULT);
        }
        if (result.moves.some((move) => move.bombTriggered)) {
            add(BuffType.BOMB_RANGE);
            add(BuffType.BOMB_SCORE_MULT);
        }
        if (result.bombNoDestroyTriggered) add(BuffType.BOMB_NO_DESTROY);
        if (state.lastBombProbTriggered) add(BuffType.BOMB_PROB, '（本次命中）');
        if (state.lastSpawn8Triggered && hasSpawnedPosition) add(BuffType.SPAWN_8_PROB, '（本次命中）');
        return tips;
    }
}
