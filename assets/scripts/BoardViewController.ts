import { Color, Graphics, Label, Layers, Node, tween, UITransform, UIOpacity, Vec3 } from 'cc';
import { ExplosionEvent, MoveResult, TileData, TileMove } from './BoardLogic';
import { SkinManager } from './SkinManager';

export interface TileView {
    node: Node;
    label: Label;
    bombLabel: Label;
    id: number;
    value: number;
    isBomb: boolean;
    row: number;
    col: number;
}

const CELL_SIZE = 136;
const GAP = 12;
const MOVE_DURATION = 0.1;
const MERGE_DURATION = 0.08;
const SPAWN_DURATION = 0.14;
const COLOR_TEXT_DARK = new Color(119, 110, 101);
const COLOR_TEXT_LIGHT = new Color(249, 246, 242);

/** 负责棋盘方块视图、移动动画、爆炸特效及炸弹引线，不参与棋盘数据计算。 */
export class BoardViewController {
    private readonly boardRoot: Node;
    private readonly tileMap = new Map<number, TileView>();

    public constructor(boardRoot: Node) {
        this.boardRoot = boardRoot;
    }

    public getTileMap(): Map<number, TileView> {
        return this.tileMap;
    }

    public cellPos(row: number, col: number): Vec3 {
        return new Vec3((col - 1.5) * (CELL_SIZE + GAP), (1.5 - row) * (CELL_SIZE + GAP), 0);
    }

    public addTile(row: number, col: number, tile: TileData, animated = false): void {
        const node = new Node('Tile');
        node.layer = Layers.Enum.UI_2D;
        node.setPosition(this.cellPos(row, col));
        this.boardRoot.addChild(node);

        const graphics = node.addComponent(Graphics);
        const size = CELL_SIZE - 8;
        this.roundRect(graphics, -size / 2, -size / 2, size, size, 8);
        graphics.fillColor = tile.isBomb ? this.bombColor().bg : this.tileColor(tile.value).bg;
        graphics.fill();

        const label = this.makeLabel('', 44, this.tileColor(tile.value).text, node, Vec3.ZERO);
        const bombLabel = this.makeLabel('炸弹', 18, COLOR_TEXT_LIGHT, node, new Vec3(0, 42, 0));
        const view: TileView = {
            node,
            label,
            bombLabel,
            id: tile.id,
            value: tile.value,
            isBomb: !!tile.isBomb,
            row,
            col,
        };
        this.renderTile(view);
        this.tileMap.set(tile.id, view);

        if (animated) {
            node.setScale(0, 0, 1);
            tween(node)
                .to(SPAWN_DURATION, { scale: new Vec3(1.08, 1.08, 1) })
                .to(0.06, { scale: new Vec3(1, 1, 1) })
                .start();
        }
    }

    public sync(board: { grid: TileData[][] }): void {
        const activeIds = new Set<number>();
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                const tile = board.grid[row][col];
                if (tile.value === 0) continue;
                activeIds.add(tile.id);
                const view = this.tileMap.get(tile.id);
                if (view) {
                    view.value = tile.value;
                    view.isBomb = !!tile.isBomb;
                    view.row = row;
                    view.col = col;
                    view.node.setPosition(this.cellPos(row, col));
                    this.renderTile(view);
                } else {
                    this.addTile(row, col, tile);
                }
            }
        }
        for (const [id, view] of this.tileMap.entries()) {
            if (!activeIds.has(id)) {
                if (view.node.isValid) view.node.destroy();
                this.tileMap.delete(id);
            }
        }
    }

    public clear(): void {
        for (const view of this.tileMap.values()) {
            if (view.node.isValid) view.node.destroy();
        }
        this.tileMap.clear();
        for (const child of this.boardRoot.children) {
            if (child.name === 'Particle' || child.name === 'ExplosionFlash' || child.name === 'ScorePopup') {
                child.destroy();
            }
        }
    }

    public removeTilesAt(positions: { row: number; col: number }[]): void {
        const targetKeys = new Set(positions.map((position) => `${position.row},${position.col}`));
        for (const [id, view] of this.tileMap.entries()) {
            if (targetKeys.has(`${view.row},${view.col}`)) {
                if (view.node.isValid) view.node.destroy();
                this.tileMap.delete(id);
            }
        }
    }

    public renderAll(): void {
        this.tileMap.forEach((view) => this.renderTile(view));
    }

    public animateMove(move: TileMove, moveVersion: number): number {
        const sourceTiles = move.sourceIds.map((id) => this.tileMap.get(id));
        const source = sourceTiles[0];
        if (!source) return 0;

        const victim = move.merged ? (sourceTiles[1] || null) : null;
        for (const id of move.sourceIds) this.tileMap.delete(id);

        if (move.merged) {
            const targetPos = this.cellPos(move.to.row, move.to.col);
            tween(source.node)
                .to(MOVE_DURATION, { position: targetPos.clone() })
                .call(() => {
                    if (moveVersion !== this.currentVersion || !source.node.isValid) return;
                    source.value = move.value;
                    source.isBomb = move.resultIsBomb;
                    this.renderTile(source);
                    this.spawnMergeParticles(targetPos, this.tileColor(move.value).bg, move.value);
                    this.spawnScorePopup(targetPos, move.value);
                })
                .to(MERGE_DURATION, { scale: new Vec3(1.3, 1.3, 1) })
                .to(MERGE_DURATION, { scale: new Vec3(1, 1, 1) })
                .start();

            if (victim) {
                tween(victim.node)
                    .to(MOVE_DURATION, { position: targetPos.clone() })
                    .to(MERGE_DURATION * 2, { scale: new Vec3(0, 0, 1) })
                    .call(() => {
                        if (victim.node.isValid) victim.node.destroy();
                    })
                    .start();
            }
            source.row = move.to.row;
            source.col = move.to.col;
            this.tileMap.set(source.id, source);
            return MOVE_DURATION + MERGE_DURATION * 2;
        }

        const targetPos = this.cellPos(move.to.row, move.to.col);
        tween(source.node).to(MOVE_DURATION, { position: targetPos.clone() }).start();
        source.row = move.to.row;
        source.col = move.to.col;
        this.tileMap.set(source.id, source);
        return MOVE_DURATION;
    }

    public animateExplosions(events: ExplosionEvent[], moveVersion: number): number {
        if (events.length === 0) return 0;
        const removedIds = new Set<number>();
        for (const event of events) {
            const center = this.cellPos(event.center.row, event.center.col);
            this.spawnExplosionParticles(center, event.value);
            for (const id of event.targetIds) {
                if (removedIds.has(id)) continue;
                removedIds.add(id);
                const tile = this.tileMap.get(id);
                if (!tile) continue;
                this.tileMap.delete(id);
                tween(tile.node)
                    .to(0.16, { scale: new Vec3(1.18, 1.18, 1) })
                    .to(0.16, { scale: new Vec3(0, 0, 1) })
                    .call(() => {
                        if (moveVersion === this.currentVersion && tile.node.isValid) tile.node.destroy();
                    })
                    .start();
            }
        }
        return 0.32;
    }

    public setCurrentVersion(version: number): void {
        this.currentVersion = version;
    }

    private currentVersion = 0;

    private renderTile(view: TileView): void {
        view.label.string = String(view.value);
        const colors = view.isBomb ? this.bombColor() : this.tileColor(view.value);
        view.bombLabel.node.active = view.isBomb;
        const digits = String(view.value).length;
        view.label.fontSize = digits <= 2 ? 52 : digits === 3 ? 44 : digits === 4 ? 34 : 28;
        view.label.color = colors.text;
        const graphics = view.node.getComponent(Graphics)!;
        graphics.clear();
        const size = CELL_SIZE - 8;
        this.roundRect(graphics, -size / 2, -size / 2, size, size, 8);
        graphics.fillColor = colors.bg;
        graphics.fill();
        const transform = view.node.getComponent(UITransform);
        if (transform) transform.setContentSize(size, size);
        this.updateBombFuseEffect(view.node, view.isBomb);
    }

    private updateBombFuseEffect(tileNode: Node, isBomb: boolean): void {
        const oldEffect = tileNode.getChildByName('BombFuse');
        if (!isBomb) {
            if (oldEffect?.isValid) oldEffect.destroy();
            return;
        }
        if (oldEffect?.isValid) return;

        const fuseNode = new Node('BombFuse');
        fuseNode.layer = tileNode.layer;
        fuseNode.setPosition(0, 0, 2);
        tileNode.addChild(fuseNode);
        const fuse = fuseNode.addComponent(Graphics);
        fuse.lineWidth = 6;
        fuse.strokeColor = new Color(74, 43, 31, 255);
        fuse.moveTo(28, 45);
        fuse.bezierCurveTo(46, 52, 19, 63, 39, 76);
        fuse.stroke();
        fuse.lineWidth = 2;
        fuse.strokeColor = new Color(244, 180, 68, 255);
        fuse.moveTo(28, 45);
        fuse.bezierCurveTo(46, 52, 19, 63, 39, 76);
        fuse.stroke();

        const spark = new Node('Spark');
        spark.layer = tileNode.layer;
        spark.setPosition(39, 76, 1);
        fuseNode.addChild(spark);
        const core = spark.addComponent(Graphics);
        core.circle(0, 0, 5);
        core.fillColor = new Color(255, 238, 145, 255);
        core.fill();
        core.lineWidth = 2;
        core.strokeColor = new Color(255, 140, 38, 255);
        core.circle(0, 0, 7);
        core.stroke();

        const targets = [new Vec3(-18, 14, 0), new Vec3(-10, 23, 0), new Vec3(2, 26, 0), new Vec3(14, 20, 0), new Vec3(21, 9, 0)];
        targets.forEach((target, index) => {
            const particle = new Node(`SparkParticle${index}`);
            particle.layer = tileNode.layer;
            spark.addChild(particle);
            const graphics = particle.addComponent(Graphics);
            graphics.lineWidth = 2.5;
            graphics.strokeColor = index % 2 === 0 ? new Color(255, 224, 112, 255) : new Color(255, 132, 38, 255);
            graphics.moveTo(0, 0);
            graphics.lineTo(-target.x * 0.16, -target.y * 0.16);
            graphics.stroke();
            graphics.circle(0, 0, 2.5);
            graphics.fillColor = new Color(255, 235, 140, 255);
            graphics.fill();
            const opacity = particle.addComponent(UIOpacity);
            tween(particle)
                .repeatForever(tween(particle)
                    .delay(index * 0.07)
                    .to(0.28, { position: target, scale: new Vec3(0.45, 0.45, 1) })
                    .call(() => {
                        if (particle.isValid) {
                            particle.setPosition(0, 0, 0);
                            particle.setScale(1, 1, 1);
                        }
                    }))
                .start();
            tween(opacity)
                .repeatForever(tween(opacity)
                    .delay(index * 0.07)
                    .to(0.28, { opacity: 0 })
                    .call(() => {
                        if (opacity.isValid) opacity.opacity = 255;
                    }))
                .start();
        });
        tween(spark)
            .repeatForever(tween(spark)
                .to(0.16, { scale: new Vec3(1.25, 1.25, 1) })
                .to(0.16, { scale: new Vec3(0.85, 0.85, 1) }))
            .start();
    }

    private spawnMergeParticles(position: Vec3, color: Color, value: number): void {
        const count = Math.min(6 + Math.floor(Math.log2(value)), 16);
        for (let i = 0; i < count; i++) {
            const particle = new Node('Particle');
            particle.layer = Layers.Enum.UI_2D;
            particle.setPosition(position.clone());
            this.boardRoot.addChild(particle);
            const graphics = particle.addComponent(Graphics);
            graphics.circle(0, 0, 4 + Math.random() * 4);
            graphics.fillColor = color;
            graphics.fill();
            const angle = Math.PI * 2 * i / count + Math.random() * 0.5;
            const distance = 30 + Math.random() * 45;
            const target = new Vec3(position.x + Math.cos(angle) * distance, position.y + Math.sin(angle) * distance, 0);
            const duration = 0.22 + Math.random() * 0.18;
            const opacity = particle.addComponent(UIOpacity);
            opacity.opacity = 255;
            tween(particle).to(duration, { position: target }).call(() => particle.destroy()).start();
            tween(opacity).to(duration * 0.7, { opacity: 0 }).start();
        }
    }

    private spawnExplosionParticles(position: Vec3, value: number): void {
        const flash = new Node('ExplosionFlash');
        flash.layer = Layers.Enum.UI_2D;
        flash.setPosition(position.clone());
        this.boardRoot.addChild(flash);
        const flashGraphics = flash.addComponent(Graphics);
        flashGraphics.circle(0, 0, 38);
        flashGraphics.fillColor = new Color(255, 226, 120, 220);
        flashGraphics.fill();
        const flashOpacity = flash.addComponent(UIOpacity);
        flashOpacity.opacity = 255;
        tween(flash).to(0.3, { scale: new Vec3(2.1, 2.1, 1) }).call(() => flash.destroy()).start();
        tween(flashOpacity).to(0.3, { opacity: 0 }).start();

        const count = Math.min(28, 16 + Math.floor(Math.log2(value)) * 2);
        for (let i = 0; i < count; i++) {
            const particle = new Node('Particle');
            particle.layer = Layers.Enum.UI_2D;
            particle.setPosition(position.clone());
            this.boardRoot.addChild(particle);
            const graphics = particle.addComponent(Graphics);
            graphics.circle(0, 0, 3 + Math.random() * 5);
            graphics.fillColor = i % 2 === 0 ? new Color(255, 128, 48) : new Color(255, 224, 92);
            graphics.fill();
            const angle = Math.PI * 2 * i / count + Math.random() * 0.3;
            const distance = 75 + Math.random() * 95;
            const target = new Vec3(position.x + Math.cos(angle) * distance, position.y + Math.sin(angle) * distance, 0);
            const duration = 0.28 + Math.random() * 0.18;
            const opacity = particle.addComponent(UIOpacity);
            opacity.opacity = 255;
            tween(particle).to(duration, { position: target, scale: new Vec3(0.2, 0.2, 1) }).call(() => particle.destroy()).start();
            tween(opacity).to(duration * 0.75, { opacity: 0 }).start();
        }
    }

    private spawnScorePopup(position: Vec3, value: number): void {
        const node = new Node('ScorePopup');
        node.layer = Layers.Enum.UI_2D;
        node.setPosition(position.clone());
        this.boardRoot.addChild(node);
        const label = this.makeLabel(`+${value}`, 32, COLOR_TEXT_DARK, node, Vec3.ZERO);
        label.fontSize = 32;
        const opacity = node.addComponent(UIOpacity);
        opacity.opacity = 255;
        tween(node).to(0.55, { position: new Vec3(position.x, position.y + 70, 0) }).call(() => node.destroy()).start();
        tween(opacity).delay(0.2).to(0.35, { opacity: 0 }).start();
    }

    private bombColor(): { bg: Color; text: Color } {
        return { bg: new Color(214, 70, 48), text: COLOR_TEXT_LIGHT };
    }

    private tileColor(value: number): { bg: Color; text: Color } {
        return SkinManager.instance.getTileStyle(value);
    }

    private makeLabel(text: string, fontSize: number, color: Color, parent: Node, position: Vec3): Label {
        const node = new Node('Label');
        node.layer = Layers.Enum.UI_2D;
        node.setPosition(position);
        parent.addChild(node);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.3);
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        return label;
    }

    private roundRect(graphics: Graphics, x: number, y: number, width: number, height: number, radius: number): void {
        graphics.roundRect(x, y, width, height, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
    }
}
