import { Difficulty } from './BoardLogic';
import { SkinManager } from './SkinManager';
import { TitleBuffService } from './TitleBuffService';

export interface EconomySnapshot {
    coinsEarned: number;
    coinBonusEarned: number;
    coinBonusRate: number;
}

/** 管理单局金币收益，持久化仍由 SkinManager 负责。 */
export class EconomyController {
    private readonly buffService: TitleBuffService;
    private lastScore = 0;
    private coinsEarned = 0;
    private coinBonusEarned = 0;
    private coinBonusRate = 0;

    public constructor(buffService: TitleBuffService) {
        this.buffService = buffService;
    }

    public startGame(): void {
        this.lastScore = 0;
        this.coinsEarned = 0;
        this.coinBonusEarned = 0;
        this.coinBonusRate = Math.max(0, this.buffService.getCoinMultiplier() - 1);
    }

    public recordScore(score: number, difficulty: Difficulty): number {
        const scoreDelta = score - this.lastScore;
        if (scoreDelta <= 0) {
            if (score === 0) this.lastScore = 0;
            return 0;
        }
        const gainedCoins = SkinManager.instance.addCoinsFromScore(scoreDelta, difficulty);
        const bonusCoins = Math.floor(gainedCoins * this.coinBonusRate);
        if (bonusCoins > 0) {
            SkinManager.instance.addCoins(bonusCoins);
            this.coinBonusEarned += bonusCoins;
        }
        this.coinsEarned += gainedCoins + bonusCoins;
        this.lastScore = score;
        return gainedCoins + bonusCoins;
    }

    public addExtraCoins(amount: number): void {
        if (amount <= 0) return;
        SkinManager.instance.addCoins(amount);
        this.coinsEarned += amount;
    }

    public doubleReward(): void {
        if (this.coinsEarned <= 0) return;
        SkinManager.instance.addCoins(this.coinsEarned * 2);
        this.coinsEarned *= 3;
    }

    public getCoinsEarned(): number {
        return this.coinsEarned;
    }

    public getSnapshot(): EconomySnapshot {
        return {
            coinsEarned: this.coinsEarned,
            coinBonusEarned: this.coinBonusEarned,
            coinBonusRate: this.coinBonusRate,
        };
    }
}
