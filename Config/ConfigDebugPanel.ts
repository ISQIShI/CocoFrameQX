import { ConfigExportScope, ConfigField, ConfigUpdateResult, ConfigValue } from './ConfigTypes';
import { ConfigTestSession, message } from './ConfigTestSession';
import { CONFIG_TEXT_LIMIT, ConfigSnapshot, configEqual } from './ConfigStore';

/** 面板打开时项目可暂停自己的输入；关闭时只撤销这一个暂停原因。 */
export interface ConfigPanelOptions { onVisibilityChange?: (visible: boolean) => void }

/** 一个字段的控件：读取可能因输入不完整而抛出，写入只改控件显示。 */
interface FieldControl { element: HTMLElement; focus: HTMLElement; read: () => ConfigValue; write: (value: ConfigValue) => void }

/** 一行参数：控件只在挂载时创建一次，配置变化只刷新显示。 */
interface FieldRow {
    key: string; field: ConfigField; tab: string; search: string;
    element: HTMLDivElement; control: FieldControl; marks: HTMLSpanElement; note: HTMLDivElement; restore: HTMLButtonElement;
    section: HTMLDivElement; dirty: boolean; invalid: boolean;
}

/** 未声明分组的字段在面板中的归类名称。 */
const UNGROUPED = '未分组';
const ALL = '全部';
const CHANGED = '已修改';
/** 滑块只用于跨度适中的有界数值，避免大范围整数无法精确拖动。 */
const SLIDER_SPAN = 1000;

const STYLE = ':host{all:initial}*{box-sizing:border-box}[hidden]{display:none!important}' +
    '.根{--底:#111922;--面:#18222d;--面2:#223040;--线:#2d3d4f;--字:#e6edf3;--弱:#93a7ba;--主:#4ea1ff;--主深:#1d64c0;' +
    '--实时:#3fbf87;--重启:#e3a83b;--错:#ff6b6b;font:13px/1.45 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--字);color-scheme:dark}' +
    'button,input,select,textarea{font:inherit;color:inherit}' +
    'button{cursor:pointer;background:var(--面2);border:1px solid var(--线);border-radius:6px;padding:6px 10px;white-space:nowrap}' +
    'button:hover:not(:disabled){border-color:#4d6884}button:disabled{opacity:.45;cursor:default}' +
    'button.主{background:var(--主深);border-color:var(--主);color:#fff}button.确认{background:#7a2a2a;border-color:var(--错);color:#fff}' +
    ':focus-visible{outline:2px solid var(--主);outline-offset:1px}' +
    'input,select,textarea{background:#0b121a;border:1px solid var(--线);border-radius:6px;padding:5px 8px;min-width:0}' +
    'input:focus,select:focus,textarea:focus{border-color:var(--主);outline:none}' +
    '.入口{position:fixed;top:8px;right:8px;display:flex;align-items:center;gap:6px;border-radius:999px;padding:6px 14px;' +
    'background:rgba(17,25,34,.9);border-color:#4d6884;box-shadow:0 2px 10px rgba(0,0,0,.4)}' +
    '.徽标{background:var(--重启);color:#111;border-radius:999px;padding:0 6px;font-size:11px;font-weight:700}' +
    '.面板{position:fixed;top:0;right:0;width:min(460px,100vw);height:100vh;height:100dvh;display:flex;flex-direction:column;' +
    'background:var(--底);border-left:1px solid var(--线);box-shadow:-10px 0 28px rgba(0,0,0,.5);outline:none;' +
    'visibility:hidden;transform:translateX(100%);transition:transform .16s ease,visibility 0s linear .16s}' +
    '.面板.打开{visibility:visible;transform:none;transition:transform .16s ease}' +
    '.头部{display:flex;align-items:center;gap:6px;padding:12px 12px 8px}' +
    '.头部 h2{flex:1;min-width:0;margin:0;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.项目{font-size:12px;font-weight:400;color:var(--弱)}.图标{padding:4px 10px}' +
    '.搜索{margin:0 12px 8px}' +
    '.标签{display:flex;gap:4px;overflow-x:auto;padding:0 12px 8px;border-bottom:1px solid var(--线);flex:none;scrollbar-width:thin}' +
    '.标签 button{flex:none;border-radius:999px;padding:3px 10px;background:transparent;color:var(--弱)}' +
    '.标签 button[aria-selected=true]{background:var(--面2);color:var(--字);border-color:var(--主)}' +
    '.标签 button.有改动::after{content:"";display:inline-block;width:6px;height:6px;margin-left:5px;border-radius:50%;background:var(--主);vertical-align:middle}' +
    '.标签.搜索中 button{opacity:.55}.数{margin-left:4px;font-size:11px;opacity:.7}' +
    '.列表,.交换{flex:1;overflow:auto;overscroll-behavior:contain;touch-action:pan-y;padding:0 12px 12px}' +
    '.子组>h3{position:sticky;top:0;z-index:1;margin:0 -12px;padding:10px 12px 4px;font-size:12px;font-weight:600;color:var(--弱);background:var(--底)}' +
    '.参数{display:grid;grid-template-columns:minmax(0,1fr) minmax(130px,48%);gap:4px 10px;align-items:center;margin:3px 0;' +
    'padding:7px 8px 7px 9px;border-radius:6px;border-left:3px solid transparent;background:var(--面)}' +
    '.参数.宽 .控件{grid-column:1/-1}.参数.已改{border-left-color:var(--主);background:#1a2a3c}.参数.非法{border-left-color:var(--错)}' +
    '.名称{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;min-width:0}.名称 .文字{font-weight:500;overflow-wrap:anywhere}' +
    '.标记{display:inline-flex;flex-wrap:wrap;gap:4px}.标记 span{font-size:11px;line-height:16px;padding:0 5px;border-radius:4px;border:1px solid var(--线);color:var(--弱)}' +
    '.标记 .实时{color:var(--实时);border-color:rgba(63,191,135,.45)}.标记 .重启{color:var(--重启);border-color:rgba(227,168,59,.45)}' +
    '.标记 .待重启{color:#111;background:var(--重启);border-color:var(--重启)}.标记 .未应用{color:#fff;background:var(--主深);border-color:var(--主)}' +
    '.复原{flex:none;padding:2px 4px;border:none;background:none;color:var(--弱);font-size:14px;line-height:1}.复原.隐藏{visibility:hidden}' +
    '.说明{grid-column:1/-1;font-size:11.5px;color:var(--弱);overflow-wrap:anywhere}.键{font-family:ui-monospace,Consolas,monospace}' +
    '.控件{display:flex;align-items:center;gap:6px;min-width:0}.控件 input[type=number]{width:100%}' +
    '.控件 input[type=range]{flex:1 1 auto;min-width:50px;padding:0;accent-color:var(--主)}.控件 input[type=range]+input{flex:0 0 76px}' +
    '.控件 select,.控件 input[type=text],.控件 textarea{width:100%}' +
    'textarea{min-height:84px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12px}' +
    '.分量项{flex:1 1 0;display:flex;align-items:center;gap:3px;min-width:0}.分量项 span{font-size:11px;color:var(--弱)}' +
    '.色块{flex:none;width:24px;height:24px;border-radius:5px;border:1px solid var(--线)}' +
    'input[type=checkbox].开关{appearance:none;-webkit-appearance:none;position:relative;width:38px;height:22px;margin:0;padding:0;' +
    'border:none;border-radius:999px;background:#3a4b5d;cursor:pointer;transition:background .12s}' +
    'input[type=checkbox].开关::before{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .12s}' +
    'input[type=checkbox].开关:checked{background:var(--主深)}input[type=checkbox].开关:checked::before{transform:translateX(16px)}' +
    '.空{padding:24px 0;text-align:center;color:var(--弱)}' +
    '.交换 p{margin:4px 0 10px;color:var(--弱);font-size:12px}.交换 textarea{width:100%;min-height:200px}' +
    '.按钮组{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px;margin:10px 0}' +
    '.文件{display:flex;align-items:center;justify-content:center;cursor:pointer;background:var(--面2);border:1px solid var(--线);border-radius:6px;padding:6px 10px}' +
    '.文件 input{display:none}' +
    '.底部{flex:none;padding:8px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--线);background:var(--面)}' +
    '.状态{margin-bottom:8px;max-height:5.6em;overflow:auto;white-space:pre-wrap;font-size:12px;color:#ffe2a1}' +
    '.操作{display:grid;grid-template-columns:auto 1fr auto auto;gap:6px}' +
    '@media (max-width:600px){.面板{top:auto;bottom:0;left:0;width:100%;height:80vh;height:80dvh;border-left:0;' +
    'border-top:1px solid var(--线);border-radius:12px 12px 0 0;box-shadow:0 -10px 28px rgba(0,0,0,.5);transform:translateY(100%)}' +
    '.参数{grid-template-columns:minmax(0,1fr) minmax(120px,52%)}.操作{grid-template-columns:repeat(3,1fr)}.操作 .应用{grid-column:1/-1;order:-1}}' +
    '@media (prefers-reduced-motion:reduce){.面板,.面板.打开{transition:none}}';

/**
 * 无需 Cocos 场景节点的 Web 测试面板，适用于编辑器浏览器预览和已打包的 Web 页面。
 * 宽屏为右侧抽屉、窄屏为底部上拉面板；分组以标签切换，改动统一应用。
 * 原生或无 DOM 环境不创建面板，仍可使用核心及存储适配器。
 */
export class ConfigDebugPanel {
    private host: HTMLDivElement | null = null;
    private panel: HTMLDivElement | null = null;
    private entry: HTMLButtonElement | null = null;
    private badge: HTMLSpanElement | null = null;
    private search: HTMLInputElement | null = null;
    private tabBar: HTMLDivElement | null = null;
    private list: HTMLDivElement | null = null;
    private empty: HTMLDivElement | null = null;
    private exchange: HTMLDivElement | null = null;
    private exchangeButton: HTMLButtonElement | null = null;
    private text: HTMLTextAreaElement | null = null;
    private status: HTMLDivElement | null = null;
    private applyButton: HTMLButtonElement | null = null;
    private undoButton: HTMLButtonElement | null = null;
    private resetButton: HTMLButtonElement | null = null;
    private rows: FieldRow[] = [];
    private readonly tabs = new Map<string, { button: HTMLButtonElement; count: HTMLSpanElement }>();
    private tab = ALL;
    private exchangeOpen = false;
    private resetTimer: ReturnType<typeof setTimeout> | null = null;
    private unsubscribe: (() => void) | null = null;
    private visible = false;
    private readonly handlers: { type: string; listener: EventListener }[] = [];

    /** 保留测试会话和输入协调回调；构造本身不创建 DOM 或监听。 */
    constructor(private readonly session: ConfigTestSession, private readonly options: ConfigPanelOptions = {}) {}

    /** 创建“参数”入口与抽屉；关闭测试能力或没有 DOM 时返回 false，不影响游戏启动。 */
    mount(): boolean {
        if (this.host) return true;
        if (!this.session.enabled || typeof document === 'undefined' || !document.body) return false;
        const store = this.session.store;
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
        host.setAttribute('data-qx-config', store.project);
        const root = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style'); style.textContent = STYLE; root.appendChild(style);
        const shell = this.element('div', '根'); root.appendChild(shell);

        this.entry = this.button('参数', () => this.setVisible(true), '入口');
        this.entry.setAttribute('aria-label', '打开测试参数'); this.entry.setAttribute('aria-expanded', 'false');
        this.badge = this.element('span', '徽标'); this.badge.hidden = true; this.entry.appendChild(this.badge);
        shell.appendChild(this.entry);

        const panel = this.element('div', '面板'); panel.tabIndex = -1;
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '测试参数');
        shell.appendChild(panel);
        const header = this.element('div', '头部'); panel.appendChild(header);
        const title = document.createElement('h2'); title.textContent = '测试参数';
        const project = this.element('span', '项目'); project.textContent = ' · ' + store.project; title.appendChild(project);
        header.appendChild(title);
        this.exchangeButton = this.button('导入导出', () => this.showExchange(!this.exchangeOpen));
        this.exchangeButton.setAttribute('aria-pressed', 'false'); header.appendChild(this.exchangeButton);
        const close = this.button('✕', () => this.setVisible(false), '图标'); close.setAttribute('aria-label', '关闭'); close.title = '关闭（Esc）';
        header.appendChild(close);

        this.search = document.createElement('input'); this.search.type = 'search'; this.search.className = '搜索';
        this.search.placeholder = '搜索标题、分组或参数键'; this.search.setAttribute('aria-label', '搜索参数');
        this.search.addEventListener('input', () => this.filter()); panel.appendChild(this.search);
        this.tabBar = this.element('div', '标签'); this.tabBar.setAttribute('role', 'tablist'); this.tabBar.setAttribute('aria-label', '参数分组');
        panel.appendChild(this.tabBar);
        this.list = this.element('div', '列表'); panel.appendChild(this.list);
        this.empty = this.element('div', '空'); this.empty.textContent = '没有匹配的参数'; this.empty.hidden = true;
        this.exchange = this.buildExchange(); this.exchange.hidden = true; panel.appendChild(this.exchange);

        const footer = this.element('div', '底部'); panel.appendChild(footer);
        this.status = this.element('div', '状态'); this.status.setAttribute('role', 'status'); footer.appendChild(this.status);
        const actions = this.element('div', '操作'); footer.appendChild(actions);
        this.undoButton = this.button('撤销', () => this.undo()); this.undoButton.title = '把未应用的输入恢复为当前目标值';
        this.applyButton = this.button('应用改动', () => this.run(() => this.reportApply(this.apply())), '应用');
        this.applyButton.title = '提交全部未应用的改动（Ctrl+Enter）';
        const save = this.button('保存到本机', () => this.run(() => { this.apply(); this.session.save(); this.reportState('已保存改动，下次打开生效'); }));
        this.resetButton = this.button('恢复项目参数', () => this.confirmReset());
        actions.append(this.undoButton, this.applyButton, save, this.resetButton);

        this.buildRows();
        // 阻止面板内事件冒泡到游戏的全局监听；捕获阶段输入由项目的可见性回调协调暂停。
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel',
            'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'wheel', 'keydown', 'keyup']) {
            const listener: EventListener = event => event.stopPropagation();
            host.addEventListener(type, listener);
            this.handlers.push({ type, listener });
        }
        panel.addEventListener('keydown', event => this.shortcut(event));
        this.host = host; this.panel = panel; document.body.appendChild(host);
        this.unsubscribe = store.subscribe(snapshot => { this.sync(snapshot); this.reportState('配置已更新'); });
        this.sync(store.snapshot()); this.reportState('参数已加载');
        if (this.session.panelRequested) this.setVisible(true);
        return true;
    }

    /** 显示或收起面板；不擅自暂停引擎或清除项目已有的其他暂停状态。未应用的输入在收起后保留。 */
    setVisible(visible: boolean): void {
        if (!this.panel || this.visible === visible) return;
        this.visible = visible;
        this.panel.classList.toggle('打开', visible);
        this.entry!.hidden = visible; this.entry!.setAttribute('aria-expanded', String(visible));
        if (visible) this.panel.focus({ preventScroll: true });
        try { this.options.onVisibilityChange?.(visible); }
        catch (error) { this.report('项目输入协调回调失败：' + message(error)); }
    }

    /** 解除订阅与事件并删除自身节点，供场景退出或预览结束调用。 */
    dispose(): void {
        this.setVisible(false);
        this.unsubscribe?.(); this.unsubscribe = null;
        if (this.resetTimer !== null) clearTimeout(this.resetTimer);
        this.resetTimer = null;
        for (const { type, listener } of this.handlers) this.host?.removeEventListener(type, listener);
        this.handlers.length = 0;
        this.host?.remove(); this.host = null; this.panel = null; this.entry = null; this.badge = null;
        this.search = null; this.tabBar = null; this.list = null; this.empty = null; this.exchange = null; this.exchangeButton = null;
        this.text = null; this.status = null; this.applyButton = null; this.undoButton = null; this.resetButton = null;
        this.rows = []; this.tabs.clear();
    }

    /** 按声明一次创建全部行；分组路径第一段作为标签，完整路径作为子分组标题。 */
    private buildRows(): void {
        const sections = new Map<string, HTMLDivElement>(), counts = new Map<string, number>();
        for (const [key, field] of this.session.store.fields()) {
            const group = field.group || UNGROUPED, tab = group.split('·')[0];
            let section = sections.get(group);
            if (!section) {
                section = this.element('div', '子组');
                const heading = document.createElement('h3'); heading.textContent = group.split('·').join(' · ');
                section.appendChild(heading); sections.set(group, section); this.list!.appendChild(section);
            }
            counts.set(tab, (counts.get(tab) || 0) + 1);
            const name = (field.group ? field.group + ' / ' : '') + field.label;
            const element = this.element('div', '参数'); element.dataset.key = key;
            if (field.kind === '向量' || field.kind === '数据') element.classList.add('宽');
            const head = this.element('div', '名称');
            const label = this.element('span', '文字'); label.textContent = field.label;
            const marks = this.element('span', '标记');
            const restore = this.button('↺', () => {}, '复原');
            restore.setAttribute('aria-label', '恢复默认：' + name); restore.title = '恢复声明默认值（需应用）';
            head.append(label, marks);
            const control = this.control(field, name); control.element.classList.add('控件'); control.element.appendChild(restore);
            const note = this.element('div', '说明');
            element.append(head, control.element, note); section.appendChild(element);
            const row: FieldRow = { key, field, tab, search: [key, field.label, group].join(' ').toLowerCase(),
                element, control, marks, note, restore, section, dirty: false, invalid: false };
            restore.addEventListener('click', () => { control.write(field.defaultValue); this.touch(row); });
            element.addEventListener('input', () => this.touch(row));
            element.addEventListener('change', () => this.touch(row));
            this.rows.push(row);
        }
        this.list!.appendChild(this.empty!);
        this.addTab(ALL, this.rows.length);
        this.addTab(CHANGED, 0);
        counts.forEach((count, tab) => this.addTab(tab, count));
    }

    /** 创建一个分组标签。 */
    private addTab(name: string, count: number): void {
        const button = this.button(name, () => { this.tab = name; if (this.search) this.search.value = ''; this.filter(); });
        button.setAttribute('role', 'tab');
        const badge = this.element('span', '数'); badge.textContent = String(count); button.appendChild(badge);
        this.tabBar!.appendChild(button); this.tabs.set(name, { button, count: badge });
    }

    /** 创建导入导出页：文本框与低频操作集中在此，不占用调参视图。 */
    private buildExchange(): HTMLDivElement {
        const page = this.element('div', '交换');
        const note = document.createElement('p');
        note.textContent = '粘贴或选择配置 JSON 后导入到本次会话；导出、下载与复现链接会先应用未提交的改动。“改动”只含相对项目参数的差异。';
        page.appendChild(note);
        this.text = document.createElement('textarea'); this.text.maxLength = CONFIG_TEXT_LIMIT;
        this.text.placeholder = '在此粘贴配置 JSON；导出的 JSON 或复现链接也显示在此';
        this.text.setAttribute('aria-label', '配置导入导出内容'); page.appendChild(this.text);
        const group = this.element('div', '按钮组'); page.appendChild(group);
        group.appendChild(this.button('导入 JSON', () => this.run(() => this.reportImport(this.session.store.importDocument(this.text!.value), 'JSON 已导入'))));
        const file = document.createElement('label'); file.className = '文件'; file.textContent = '选择文件';
        const upload = document.createElement('input'); upload.type = 'file'; upload.accept = '.json,application/json';
        upload.setAttribute('aria-label', '选择配置 JSON 文件');
        upload.addEventListener('change', () => this.readFile(upload));
        file.appendChild(upload); group.appendChild(file);
        group.appendChild(this.button('导出改动', () => this.run(() => this.exportText('改动'))));
        group.appendChild(this.button('导出全部', () => this.run(() => this.exportText('全部'))));
        group.appendChild(this.button('下载 JSON', () => this.run(() => { this.apply(); this.download(); })));
        group.appendChild(this.button('生成复现链接', () => this.run(() => {
            this.apply(); this.text!.value = this.session.shareURL(); this.reportState('链接已生成，只携带相对项目参数的改动；打开后按目标值启动');
        })));
        group.appendChild(this.button('复制文本', () => this.copy()));
        return page;
    }

    /** 读取选择的配置文件并导入，文件过大或读取失败时只提示。 */
    private readFile(upload: HTMLInputElement): void {
        const file = upload.files?.[0];
        if (!file) return;
        if (file.size > CONFIG_TEXT_LIMIT * 4) { this.report('文件过大，请导入小于 256K 的 JSON'); upload.value = ''; return; }
        const reader = new FileReader();
        reader.onload = () => {
            if (!this.host) return;
            this.run(() => {
                const issues = this.session.store.importDocument(String(reader.result));
                this.text!.value = String(reader.result);
                this.reportImport(issues, '文件已导入');
            });
            upload.value = '';
        };
        reader.onerror = () => { if (this.host) this.report('文件读取失败，请直接粘贴 JSON'); };
        reader.readAsText(file);
    }

    /** 切换调参视图与导入导出页。 */
    private showExchange(open: boolean): void {
        this.exchangeOpen = open;
        this.exchange!.hidden = !open; this.list!.hidden = open; this.tabBar!.hidden = open; this.search!.hidden = open;
        this.exchangeButton!.textContent = open ? '返回参数' : '导入导出';
        this.exchangeButton!.setAttribute('aria-pressed', String(open));
    }

    /** 按字段类型生成控件；新增字段类型时与容器的校验表各加一项。 */
    private control(field: ConfigField, name: string): FieldControl {
        switch (field.kind) {
            case '开关': {
                const input = document.createElement('input'); input.type = 'checkbox'; input.className = '开关';
                input.setAttribute('role', 'switch'); input.setAttribute('aria-label', name);
                const box = this.element('div'); box.appendChild(input);
                return { element: box, focus: input, read: () => input.checked, write: value => { input.checked = value as boolean; } };
            }
            case '选项': {
                const select = document.createElement('select'); select.setAttribute('aria-label', name);
                for (const choice of field.choices) { const option = document.createElement('option'); option.value = choice; option.textContent = choice; select.appendChild(option); }
                const box = this.element('div'); box.appendChild(select);
                return { element: box, focus: select, read: () => select.value, write: value => { select.value = String(value); } };
            }
            case '数据': {
                const input = document.createElement('textarea'); input.maxLength = CONFIG_TEXT_LIMIT; input.setAttribute('aria-label', name);
                const box = this.element('div'); box.appendChild(input);
                return { element: box, focus: input, write: value => { input.value = JSON.stringify(value, null, 2); }, read: () => {
                    try { return JSON.parse(input.value) as ConfigValue; }
                    catch { throw new Error(field.label + ' 不是有效的 JSON'); }
                } };
            }
            case '向量': {
                const box = this.element('div');
                const swatch = field.components.join() === 'r,g,b,a' ? this.element('span', '色块') : null;
                if (swatch) box.appendChild(swatch);
                const inputs = field.components.map(component => {
                    const item = document.createElement('label'); item.className = '分量项';
                    const tag = this.element('span'); tag.textContent = component;
                    const input = this.numberInput(field); input.setAttribute('aria-label', name + ' ' + component);
                    item.append(tag, input); box.appendChild(item); return input;
                });
                const paint = () => {
                    if (!swatch) return;
                    const [r, g, b, a] = inputs.map(input => Number(input.value) || 0);
                    swatch.style.background = 'rgba(' + r + ',' + g + ',' + b + ',' + a / 255 + ')';
                };
                box.addEventListener('input', paint);
                return { element: box, focus: inputs[0],
                    read: () => inputs.map((input, i) => this.readNumber(input, field.label + ' ' + field.components[i])),
                    write: value => { inputs.forEach((input, i) => { input.value = String((value as number[])[i]); }); paint(); } };
            }
            case '数值': {
                const box = this.element('div');
                const input = this.numberInput(field); input.setAttribute('aria-label', name);
                let slider: HTMLInputElement | null = null;
                if (field.min !== undefined && field.max !== undefined && field.max - field.min <= SLIDER_SPAN) {
                    const range = document.createElement('input'); range.type = 'range';
                    range.min = String(field.min); range.max = String(field.max);
                    range.step = String(field.step ?? (field.integer ? 1 : 'any')); range.setAttribute('aria-label', name + ' 滑块');
                    range.addEventListener('input', () => { input.value = range.value; });
                    input.addEventListener('input', () => { if (input.value.trim() && Number.isFinite(Number(input.value))) range.value = input.value; });
                    box.appendChild(range); slider = range;
                }
                box.appendChild(input);
                return { element: box, focus: input, read: () => this.readNumber(input, field.label),
                    write: value => { input.value = String(value); if (slider) slider.value = String(value); } };
            }
            default: {
                const input = document.createElement('input'); input.type = 'text'; input.maxLength = field.maxLength ?? 1024;
                input.setAttribute('aria-label', name);
                const box = this.element('div'); box.appendChild(input);
                return { element: box, focus: input, read: () => input.value, write: value => { input.value = String(value); } };
            }
        }
    }

    /** 创建带范围与步长的数字输入框。 */
    private numberInput(field: { min?: number; max?: number; step?: number; integer?: boolean }): HTMLInputElement {
        const input = document.createElement('input'); input.type = 'number';
        if (field.min !== undefined) input.min = String(field.min);
        if (field.max !== undefined) input.max = String(field.max);
        input.step = String(field.step ?? (field.integer ? 1 : 'any'));
        return input;
    }

    /** 读取数字输入，空值或非数字直接报错而不当作零。 */
    private readNumber(input: HTMLInputElement, label: string): number {
        const value = Number(input.value);
        if (!input.value.trim() || !Number.isFinite(value)) throw new Error(label + ' 不能为空且必须是数字');
        return value;
    }

    /** 输入后重新判断该行是否与目标值不同；无法读取的输入标为非法。 */
    private touch(row: FieldRow): void {
        const snapshot = this.session.store.snapshot();
        this.check(row, snapshot);
        this.refreshRow(row, snapshot); this.refreshCounts(snapshot);
        if (this.tab === CHANGED && !this.query()) this.filter();
    }

    /** 比较控件与目标值，更新未应用和非法状态。 */
    private check(row: FieldRow, snapshot: ConfigSnapshot): void {
        try { row.dirty = !configEqual(row.control.read(), snapshot.desired[row.key]); row.invalid = false; }
        catch { row.dirty = true; row.invalid = true; }
    }

    /** 配置变化后只刷新显示：未修改的控件跟随目标值，未应用的输入保留。 */
    private sync(snapshot: ConfigSnapshot): void {
        for (const row of this.rows) {
            if (row.dirty) this.check(row, snapshot);
            if (!row.dirty) row.control.write(snapshot.desired[row.key]);
            this.refreshRow(row, snapshot);
        }
        this.refreshCounts(snapshot); this.filter();
    }

    /** 刷新行标记与说明：生效时机、非默认来源、未应用、待重启及范围。 */
    private refreshRow(row: FieldRow, snapshot: ConfigSnapshot): void {
        const { field, key } = row, source = snapshot.sources[key], pending = snapshot.pendingRestart.indexOf(key) !== -1;
        row.element.classList.toggle('已改', row.dirty && !row.invalid);
        row.element.classList.toggle('非法', row.invalid);
        const marks: [string, string][] = [[field.timing || '重启', field.timing === '实时' ? '实时' : '重启']];
        if (source !== '默认') marks.push([source, '来源']);
        if (pending) marks.push(['待重启', '待重启']);
        if (row.dirty) marks.push([row.invalid ? '输入有误' : '未应用', '未应用']);
        row.marks.replaceChildren(...marks.map(([text, className]) => { const tag = this.element('span', className); tag.textContent = text; return tag; }));
        row.restore.classList.toggle('隐藏', !row.dirty && configEqual(snapshot.desired[key], field.defaultValue));
        const keyText = this.element('span', '键'); keyText.textContent = key;
        const limits = field.kind === '数值' || field.kind === '向量';
        const parts = [limits && (field.min !== undefined || field.max !== undefined) ? '范围 ' + (field.min ?? '不限') + ' ～ ' + (field.max ?? '不限') : '',
            field.description || '', pending ? '当前仍为 ' + JSON.stringify(snapshot.active[key]).slice(0, 160) : ''].filter(Boolean);
        row.note.replaceChildren(keyText, document.createTextNode(parts.length ? ' · ' + parts.join(' · ') : ''));
    }

    /** 刷新标签计数、标签改动点、应用按钮与入口徽标。 */
    private refreshCounts(snapshot: ConfigSnapshot): void {
        const dirty = this.rows.filter(row => row.dirty).length;
        this.tabs.get(CHANGED)!.count.textContent = String(this.rows.filter(row => this.changed(row, snapshot)).length);
        this.tabs.forEach((tab, name) => {
            if (name !== ALL && name !== CHANGED) tab.button.classList.toggle('有改动', this.rows.some(row => row.tab === name && row.dirty));
        });
        this.applyButton!.textContent = dirty ? '应用 ' + dirty + ' 项改动' : '应用改动';
        this.applyButton!.classList.toggle('主', dirty > 0);
        this.undoButton!.disabled = dirty === 0;
        const pending = snapshot.pendingRestart.length;
        this.badge!.hidden = pending === 0; this.badge!.textContent = String(pending);
        this.badge!.title = pending + ' 项等待重启';
    }

    /** “已修改”包含未应用输入及本地或本次会话的覆盖。 */
    private changed(row: FieldRow, snapshot: ConfigSnapshot): boolean {
        const source = snapshot.sources[row.key];
        return row.dirty || source === '本地' || source === '会话';
    }

    /** 只提交未应用的改动，读取失败时定位到出错控件；整批校验保证跨字段关系不出现短暂非法状态。 */
    private apply(): ConfigUpdateResult {
        const desired = this.session.store.snapshot().desired;
        const changes: Record<string, ConfigValue> = Object.create(null);
        for (const row of this.rows) {
            if (!row.dirty) continue;
            let value: ConfigValue;
            try { value = row.control.read(); }
            catch (error) { this.reveal(row); throw error; }
            if (!configEqual(value, desired[row.key])) changes[row.key] = value;
        }
        if (!Object.keys(changes).length) return { changed: false, deferred: false };
        return this.session.store.patchLayer('会话', changes);
    }

    /** 把全部未应用输入恢复为当前目标值。 */
    private undo(): void {
        const snapshot = this.session.store.snapshot();
        let count = 0;
        for (const row of this.rows) {
            if (!row.dirty) continue;
            row.control.write(snapshot.desired[row.key]); row.dirty = false; row.invalid = false; count++;
            this.refreshRow(row, snapshot);
        }
        this.refreshCounts(snapshot); this.filter();
        this.reportState('已撤销 ' + count + ' 项未应用的输入');
    }

    /** 清除本地与会话覆盖前需在三秒内再次点击确认，避免误删保存。 */
    private confirmReset(): void {
        const button = this.resetButton!;
        if (this.resetTimer === null) {
            button.textContent = '再次点击确认清除'; button.classList.add('确认');
            this.resetTimer = setTimeout(() => this.clearResetConfirm(), 3000);
            return;
        }
        this.clearResetConfirm();
        this.run(() => {
            for (const row of this.rows) { row.dirty = false; row.invalid = false; }
            const issues = this.session.reset();
            // 覆盖本已为空时容器不会通知，仍需把清除的草稿换回目标值。
            this.sync(this.session.store.snapshot());
            this.reportState(['已清除测试覆盖', ...issues].join('\n'));
        });
    }

    /** 撤销确认状态。 */
    private clearResetConfirm(): void {
        if (this.resetTimer !== null) clearTimeout(this.resetTimer);
        this.resetTimer = null;
        if (this.resetButton) { this.resetButton.textContent = '恢复项目参数'; this.resetButton.classList.remove('确认'); }
    }

    /** 切换到出错行所在分组并聚焦其控件。 */
    private reveal(row: FieldRow): void {
        if (this.exchangeOpen) this.showExchange(false);
        if (row.element.hidden) { this.tab = row.tab; if (this.search) this.search.value = ''; this.filter(); }
        row.control.focus.focus({ preventScroll: true });
        row.element.scrollIntoView({ block: 'nearest' });
    }

    /** 面板内快捷键：Esc 关闭，Ctrl/Cmd+Enter 应用。 */
    private shortcut(event: KeyboardEvent): void {
        if (event.key === 'Escape') { event.preventDefault(); this.setVisible(false); }
        else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); this.run(() => this.reportApply(this.apply())); }
    }

    /** 按应用结果提示：无改动、正常应用或整体推迟到重启。 */
    private reportApply(result: ConfigUpdateResult): void {
        if (!result.changed) this.reportState('没有改动');
        else if (result.deferred) this.reportState('参数已作为重启生效保存：本次改动中的实时参数与本局重启参数组合不合法，已整体推迟到重启');
        else this.reportState('参数已应用');
    }

    /** 提示导入结果，并列出宽松导入跳过的内容。 */
    private reportImport(issues: readonly string[], text: string): void {
        this.reportState([text, ...issues].join('\n'));
    }

    /** 先应用面板输入，再把指定范围的配置写入文本框。 */
    private exportText(scope: ConfigExportScope): void {
        this.apply(); this.text!.value = this.session.store.exportJSON(scope);
        this.reportState(scope === '改动' ? '已导出相对项目参数的改动，可复制或下载' : '已导出完整目标值，可作为项目配置文件');
    }

    /** 复制文本框内容；剪贴板不可用时选中文本，提示手动复制。 */
    private copy(): void {
        const text = this.text!;
        if (!text.value) { this.report('没有可复制的内容，请先导出或生成链接'); return; }
        const fallback = () => { text.focus(); text.select(); this.report('已选中文本，请手动复制'); };
        try {
            if (!navigator.clipboard) { fallback(); return; }
            navigator.clipboard.writeText(text.value).then(() => this.report('已复制到剪贴板'), fallback);
        } catch { fallback(); }
    }

    /** 当前搜索词。 */
    private query(): string { return this.search?.value.trim().toLowerCase() || ''; }

    /** 搜索时跨全部分组筛选；否则按当前标签显示，隐藏没有可见行的子分组。 */
    private filter(): void {
        if (!this.list) return;
        const query = this.query(), snapshot = this.session.store.snapshot(), visible = new Set<HTMLDivElement>();
        for (const row of this.rows) {
            const show = query ? row.search.indexOf(query) !== -1
                : this.tab === ALL || (this.tab === CHANGED ? this.changed(row, snapshot) : row.tab === this.tab);
            row.element.hidden = !show;
            if (show) visible.add(row.section);
        }
        for (const row of this.rows) row.section.hidden = !visible.has(row.section);
        this.empty!.hidden = visible.size > 0;
        this.empty!.textContent = query ? '没有匹配的参数' : this.tab === CHANGED ? '没有改动或覆盖' : '没有参数';
        this.tabBar!.classList.toggle('搜索中', !!query);
        this.tabs.forEach((tab, name) => tab.button.setAttribute('aria-selected', String(!query && name === this.tab)));
    }

    /** 生成标准按钮，统一使用显式点击行为，不注册全局快捷键。 */
    private button(label: string, action: () => void, className = ''): HTMLButtonElement {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.className = className;
        button.addEventListener('click', action); return button;
    }

    /** 创建普通容器，使用文本节点展示外部输入，避免把配置当作 HTML。 */
    private element<K extends 'div' | 'span'>(tag: K, className = ''): HTMLElementTagNameMap[K] {
        const node = document.createElement(tag); node.className = className; return node;
    }

    /** 下载相对项目参数的改动，并及时释放临时对象地址。 */
    private download(): void {
        const blob = new Blob([this.session.store.exportJSON('改动')], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a'); anchor.href = url;
        anchor.download = this.session.store.project.replace(/[^a-zA-Z0-9_一-鿿-]/g, '_') + '-测试配置.json';
        // 下载产生的合成点击也必须留在面板事件边界内，避免传给游戏的全局点击监听。
        this.panel!.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.reportState('已发起改动 JSON 下载；若环境限制下载，可用导出改动复制文本');
    }

    /** 在面板内显示失败，保留现有游戏和上一份有效参数。 */
    private run(action: () => void): void {
        try { action(); } catch (error) { this.report(message(error)); }
    }

    /** 显示中文状态消息，保留换行便于阅读多个诊断。 */
    private report(text: string): void { if (this.status) this.status.textContent = text; }

    /** 提示待重启数量；保存目标值不表示运行中的实例已经更新。 */
    private reportState(text: string): void {
        const pending = this.session.store.snapshot().pendingRestart.length;
        this.report(text + (pending ? '\n有 ' + pending + ' 项等待重新启动游戏；刷新前先保存，或用复现链接打开。' : '\n当前无待重启参数。'));
    }
}
