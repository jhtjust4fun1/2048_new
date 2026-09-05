import { BlockInputEvents, Color, Graphics, Label, Layers, Node, UITransform, Vec3 } from 'cc';
import { Difficulty } from './BoardLogic';

export interface DifficultyViewRefs {
    overlay: Node;
    panel: Node;
    easyButton: Node;
    normalButton: Node;
    hardButton: Node;
    nightmareButton: Node;
}

export class DifficultyViewController {
    private readonly refs: DifficultyViewRefs;
    private readonly onSelect: (difficulty: Difficulty) => void;

    public constructor(refs: DifficultyViewRefs, onSelect: (difficulty: Difficulty) => void) {
        this.refs = refs;
        this.onSelect = onSelect;
    }

    public setup(): void {
        this.drawPanel(this.refs.panel, new Color(250, 248, 239), 14);
        this.drawOverlayMask(this.refs.overlay);

        this.drawPanel(this.refs.easyButton, new Color(143, 122, 102), 10);
        this.drawPanel(this.refs.normalButton, new Color(143, 122, 102), 10);
        this.drawPanel(this.refs.hardButton, new Color(143, 122, 102), 10);
        this.drawPanel(this.refs.nightmareButton, new Color(143, 122, 102), 10);

        this.bindButton(this.refs.easyButton, 'easy');
        this.bindButton(this.refs.normalButton, 'normal');
        this.bindButton(this.refs.hardButton, 'hard');
        this.bindButton(this.refs.nightmareButton, 'nightmare');
    }

    public show(): void {
        this.refs.overlay.active = true;
    }

    public hide(): void {
        this.refs.overlay.active = false;
    }

    private bindButton(button: Node, difficulty: Difficulty): void {
        button.on(Node.EventType.TOUCH_END, () => this.onSelect(difficulty), this);
    }

    private drawPanel(node: Node, color: Color, radius: number): void {
        const transform = node.getComponent(UITransform);
        if (!transform) return;
        const graphics = node.getComponent(Graphics) || node.addComponent(Graphics);
        graphics.clear();
        graphics.roundRect(-transform.width / 2, -transform.height / 2,
            transform.width, transform.height, Math.min(radius, transform.width / 2, transform.height / 2));
        graphics.fillColor = color;
        graphics.fill();
        node.getComponent(BlockInputEvents) || node.addComponent(BlockInputEvents);
    }

    private drawOverlayMask(node: Node): void {
        const transform = node.getComponent(UITransform);
        if (!transform) return;
        const graphics = node.getComponent(Graphics) || node.addComponent(Graphics);
        graphics.clear();
        graphics.fillColor = new Color(0, 0, 0, 160);
        graphics.rect(-transform.width / 2, -transform.height / 2, transform.width, transform.height);
        graphics.fill();
    }
}
