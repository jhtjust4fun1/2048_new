import { _decorator, Component, Node, Graphics, Color, UITransform, Sprite, Label, Vec3, tween, UIOpacity, director, resources, SpriteFrame, error } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('SplashSceneManager')
export class SplashSceneManager extends Component {

    protected start(): void {
        this.buildSplashScreen();
    }

    private buildSplashScreen(): void {
        // 创建背景
        const bgGraphics = this.node.addComponent(Graphics);
        bgGraphics.fillColor = new Color(10, 10, 15, 255);
        // 假设设计分辨率为 720x1280
        bgGraphics.rect(-360, -640, 720, 1280);
        bgGraphics.fill();

        // 闪屏图片
        const imgNode = new Node('SplashImage');
        imgNode.layer = this.node.layer;
        this.node.addChild(imgNode);
        const imgTrans = imgNode.addComponent(UITransform);
        imgTrans.setContentSize(720, 1280); // 使用竖屏全屏背景图
        const sprite = imgNode.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        
        resources.load('game_res/game_1/spriteFrame', SpriteFrame, (err, sf) => {
            if (err) {
                error('Failed to load game_res/game_1:', err);
                return;
            }
            if (this.node && this.node.isValid) {
                sprite.spriteFrame = sf;
            }
        });

        // 标题
        const titleNode = new Node('Title');
        titleNode.layer = this.node.layer;
        titleNode.setPosition(0, 400, 0);
        this.node.addChild(titleNode);
        const titleLabel = titleNode.addComponent(Label);
        titleLabel.string = '2048 BOOM!';
        titleLabel.fontSize = 64;
        titleLabel.isBold = true;
        titleLabel.color = new Color(255, 220, 80);
        titleNode.active = false;

        // 闪烁特效 - 标题呼吸
        const op = titleNode.addComponent(UIOpacity);
        tween(op).repeatForever(
            tween(op).to(0.8, { opacity: 120 }).to(0.8, { opacity: 255 })
        ).start();

        // 爆炸进入游戏按钮
        const startBtn = new Node('SplashStartBtn');
        startBtn.layer = this.node.layer;
        startBtn.setPosition(0, -420, 0);
        this.node.addChild(startBtn);
        const btnTrans = startBtn.addComponent(UITransform);
        btnTrans.setContentSize(240, 72);
        
        // 绘制按钮背景
        this.drawPanel(startBtn, new Color(255, 94, 30), 36);
        
        // 按钮文字
        const btnTextNode = new Node('Label');
        btnTextNode.layer = this.node.layer;
        startBtn.addChild(btnTextNode);
        const btnLabel = btnTextNode.addComponent(Label);
        btnLabel.string = '🔥 爆发开始';
        btnLabel.fontSize = 32;
        btnLabel.color = new Color(255, 255, 255); // COLOR_TEXT_LIGHT

        startBtn.on(Node.EventType.TOUCH_END, () => {
            // 简单的爆炸消失动画
            tween(this.node)
                .to(0.4, { scale: new Vec3(1.2, 1.2, 1.2) })
                .start();
            
            const screenOp = this.node.addComponent(UIOpacity);
            tween(screenOp)
                .to(0.4, { opacity: 0 })
                .call(() => {
                    director.loadScene('Main');
                })
                .start();
        }, this);

        // 底部通用健康忠告
        this.buildHealthNotice();
    }

    private buildHealthNotice(): void {
        const noticeNode = new Node('HealthNotice');
        noticeNode.layer = this.node.layer;
        noticeNode.setPosition(0, -588, 0);
        this.node.addChild(noticeNode);

        const trans = noticeNode.addComponent(UITransform);
        trans.setContentSize(680, 90);

        const label = noticeNode.addComponent(Label);
        label.string = '健康游戏忠告\n抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。\n适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。';
        label.fontSize = 15;
        label.lineHeight = 22;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = new Color(255, 255, 255, 160);
    }

    private drawPanel(node: Node, color: Color, radius: number): void {
        const graphics = node.addComponent(Graphics);
        const transform = node.getComponent(UITransform);
        if (!graphics || !transform) return;

        graphics.fillColor = color;
        graphics.roundRect(-transform.width / 2, -transform.height / 2, transform.width, transform.height, radius);
        graphics.fill();
    }
}
