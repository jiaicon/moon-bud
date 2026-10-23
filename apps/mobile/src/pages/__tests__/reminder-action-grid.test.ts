import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..', '..')
const source = readFileSync(join(srcDir, 'pages/reminder-form/index.vue'), 'utf8')

/**
 * 「到点顺手记」这一格不能把话说过头。服务端只认完整的预填（半份直接 400），
 * 所以界面上"到点直接记"这句话只有在填齐并且校验通过时才许出现；
 * 没填齐就得老实说"到点打开记一笔"，并且半份 payload 绝不发出去。
 */
describe('提醒的「到点顺手记」', () => {
  it('动作类型走芯片行，且第一格是"不带动作"', () => {
    expect(source).toMatch(/actionType\s*=\s*ref\(''\)/)
    expect(source).toMatch(/@click="pickAction\(/)
    expect(source).toMatch(/v-for="t in EVENT_TYPES"/)
  })

  it('选了动作却没选孩子时当场拦住，不让它变成一条到点记不进去的提醒', () => {
    expect(source).toMatch(/pickAction[\s\S]{0,240}?showToast/)
    expect(source).toMatch(/if \(!actionKept\.value && actionType\.value && !childId\.value\)/)
  })

  it('提示语说实话：填齐才说"直接记"，没填齐说"打开记一笔"', () => {
    expect(source).toMatch(/到点直接记/)
    expect(source).toMatch(/到点打开记一笔/)
    expect(source).toMatch(/actionReady/)
  })

  /**
   * 只有两句话的话，"体温填了个 120"和"体温一个字没填"会得到同一句
   * "必填项还没填全"——可人明明填了，于是以为保存出了问题。
   * 反过来，睡眠/生长发育这类没有必填项的类型，一栏都不填也算"填齐"，
   * 那句"点一下「记一笔」就写下这条"得说清楚写下的是光板一条。
   */
  it('提示语分清"没填全"与"填了但不合格"，没有必填项的类型也不谎报', () => {
    expect(source).toMatch(/const actionHint = computed\(\(\) =>/)
    expect(source).toMatch(/\{\{ actionHint \}\}/)
    expect(source).toMatch(/必填项都填了，可这份预填不合格/)
    expect(source).toMatch(/没有必填项/)
    // 生长发育：这一格一栏都渲染不出来（必填项为空），但 refine 要至少一项测量值 —— 
    // 对着空白说"必填项都填了"是句疯话。
    expect(source).toMatch(/这一格没有可填的栏/)
    // 不再用一句三元表达式包三态
    expect(source).not.toMatch(/actionReady \? '到点直接记/)
  })

  it('没填齐的预填不发出去（服务端只认完整 payload，半份会 400）', () => {
    expect(source).toMatch(/actionPayload: actionReady\.value \? buildActionPayload\(\) : null/)
  })

  it('编辑时回显动作', () => {
    expect(source).toMatch(/actionType\.value = reminder\.eventType \?\? ''/)
  })

  /**
   * 回显时把存好的 payload 整个抄进 actionValues，但界面上只列必填项，
   * 提交时又按"界面上这几栏"重建 payload —— 于是编辑一次标题再保存，
   * 药那条提醒的"用法"这种可选项就没了。服务端本来支持"不动作就原样留着"
   * （reminder-action.e2e-spec.ts 里 PATCH 只改标题那条），所以修法是不发这两个键。
   */
  it('编辑时没碰这一格就不发动作，存下的可选项原样留着', () => {
    expect(source).toMatch(/const actionTouched = ref\(false\)/)
    expect(source).toMatch(/const actionKept = computed\(\(\) => isEdit\.value && !actionTouched\.value\)/)
    expect(source).toMatch(/\.\.\.\(actionKept\.value \? \{\} : action\)/)
    // 动作被保留时不能顺手把动作的校验也捎上：这一格没碰，就别拦。
    expect(source).toMatch(/if \(!actionKept\.value && actionType\.value && !childId\.value\)/)
  })

  /**
   * 这一格只列必填项，可选项（药品"用法"、体温"测量部位"）在界面上根本没有栏。
   * 所以就算用户真的改了动作（改个药品名），重建 payload 也得从存好的那一份长出来，
   * 不然"编辑—保存"每走一次就抹掉一栏没人看得见、也没机会重填的东西。
   * 换了类型就不算同一份，旧的可选值不该跟到新类型上。
   */
  it('碰过这一格时也只覆盖界面上有的栏，可选项从存好的那份带回去', () => {
    expect(source).toMatch(/const storedPayload = ref<Record<string, unknown>>\(\{\}\)/)
    expect(source).toMatch(/const keptExtras = computed<Record<string, unknown>>\(\(\) =>/)
    expect(source).toMatch(/actionEventType\.value === storedType\.value \? storedPayload\.value : \{\}/)
    expect(source).toMatch(/const payload: Record<string, unknown> = \{ \.\.\.keptExtras\.value \}/)
  })

  it('拨过类型或写过任何一栏预填都算碰过这一格', () => {
    expect(source).toMatch(/function pickAction\(next[\s\S]{0,240}?actionTouched\.value = true/)
    expect(source).toMatch(/function setActionValue\(/)
    expect(source).toMatch(/@click="setActionValue\(field\.name, option\.value\)"/)
    expect(source).toMatch(/@input="actionTouched = true"/)
  })
})
