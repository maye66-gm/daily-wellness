import { dateKey, addDays, weekday, weekDates, buildWaterSchedule, getAdvice } from './logic.mjs';

const STORAGE_KEY = 'daily-wellness-v1';
const SITE_URL = 'https://maye66-gm.github.io/daily-wellness/';
const MEAL_NAMES = { breakfast: '早餐', lunch: '午餐', snack: '下午加餐', dinner: '晚餐' };
const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const modalBody = document.querySelector('#modal-body');
const toastElement = document.querySelector('#toast');
const defaults = () => ({ wake: '07:00', bed: '23:00', goal: 1700, mealTimes: {} });
const emptyStore = () => ({ schema: 'daily-wellness/v1', settings: defaults(), records: {} });
let db = emptyStore();
let storageAvailable = true;
let content;
let today = dateKey();
let selectedDate = today;
let followsToday = true;
let tab = ['today', 'week', 'water', 'report'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
let reportDirty = false;
let toastTimer;
let pendingDayChange = false;

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const esc = escapeHTML;
const list = items => (items || []).map(item => `<li>${esc(item)}</li>`).join('');
const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const validDate = value => { try { return typeof value === 'string' && addDays(value, 0) === value; } catch { return false; } };
const minuteOf = time => { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute; };
const laterTime = (first, second) => minuteOf(first) > minuteOf(second) ? first : second;
const recordFor = date => db.records[date] || {};
const ensureRecord = date => db.records[date] ||= {};
const dateLabel = date => { const [, month, day] = date.split('-'); return `${Number(month)}月${Number(day)}日 ${DAY_NAMES[weekday(date) - 1]}`; };
const isFuture = date => date > today;

function toast(message) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.add('visible');
  toastTimer = setTimeout(() => toastElement.classList.remove('visible'), 4300);
}

function validateSettings(input = {}) {
  const candidate = { ...defaults() };
  for (const key of ['wake', 'bed']) {
    if (input[key] !== undefined) {
      if (!validTime(input[key])) throw new Error('作息时间格式不正确。');
      candidate[key] = input[key];
    }
  }
  if (input.goal !== undefined) candidate.goal = Number(input.goal);
  buildWaterSchedule(candidate);
  if (input.mealTimes !== undefined) {
    if (!input.mealTimes || typeof input.mealTimes !== 'object' || Array.isArray(input.mealTimes)) throw new Error('饭点设置格式不正确。');
    for (const id of Object.keys(MEAL_NAMES)) {
      const value = input.mealTimes[id];
      if (value !== undefined && value !== '') {
        if (!validTime(value)) throw new Error('饭点时间格式不正确。');
        candidate.mealTimes[id] = value;
      }
    }
  }
  return candidate;
}

function validateReport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('每日反馈格式不正确。');
  const enums = { regular: ['yes', 'missed'], hunger: ['comfortable', 'hungry', 'very'], energy: ['fine', 'tired'], control: ['no', 'yes', 'skip'], tomorrow: ['normal', 'late', 'social'] };
  const output = {};
  for (const [field, allowed] of Object.entries(enums)) {
    if (input[field] !== undefined) {
      if (!allowed.includes(input[field])) throw new Error('反馈中包含无法识别的选项。');
      output[field] = input[field];
    }
  }
  if (input.sleep !== undefined && input.sleep !== '') {
    const hours = Number(input.sleep);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) throw new Error('睡眠时间应在 0 到 24 小时之间。');
    output.sleep = hours;
  }
  if (input.savedAt !== undefined) output.savedAt = validateStamp(input.savedAt);
  return output;
}

function validateStamp(value) {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw new Error('记录的时间格式不正确。');
  return new Date(value).toISOString();
}

function validateAmount(value) {
  if (!Number.isInteger(value) || value < 25 || value > 1000 || value % 25 !== 0) throw new Error('单次饮水记录须为 25—1000 毫升内的 25 毫升整数倍。');
  return value;
}

function validateDatabase(input) {
  if (!input || typeof input !== 'object' || input.schema !== 'daily-wellness/v1') throw new Error('请选择本页面导出的备份文件。');
  if (!input.records || typeof input.records !== 'object' || Array.isArray(input.records)) throw new Error('日期记录格式不正确。');
  if (Object.keys(input.records).length > 5000) throw new Error('备份中的记录数量过多。');
  const output = { schema: input.schema, settings: validateSettings(input.settings), records: {} };
  for (const [date, original] of Object.entries(input.records)) {
    if (!validDate(date) || !original || typeof original !== 'object' || Array.isArray(original)) throw new Error('备份中含有无效日期。');
    if (date > dateKey()) throw new Error('备份中含有未来日期的实际记录。');
    const record = {};
    for (const field of ['meals', 'alternatives']) {
      if (original[field] !== undefined) {
        if (!original[field] || typeof original[field] !== 'object' || Array.isArray(original[field])) throw new Error('餐食记录格式不正确。');
        record[field] = {};
        for (const id of Object.keys(MEAL_NAMES)) {
          if (original[field][id] !== undefined) {
            if (typeof original[field][id] !== 'boolean') throw new Error('餐食状态格式不正确。');
            record[field][id] = original[field][id];
          }
        }
      }
    }
    if (original.task !== undefined) {
      if (typeof original.task !== 'boolean') throw new Error('日常任务状态格式不正确。');
      record.task = original.task;
    }
    if (original.report !== undefined) record.report = validateReport(original.report);
    if (original.water !== undefined) {
      if (!original.water || typeof original.water !== 'object' || Array.isArray(original.water)) throw new Error('饮水记录格式不正确。');
      record.water = {};
      for (const [id, item] of Object.entries(original.water)) {
        if (!/^water-[0-7]$/.test(id) || !item || typeof item !== 'object') throw new Error('饮水时点记录格式不正确。');
        record.water[id] = { amount: validateAmount(item.amount), at: validateStamp(item.at) };
      }
    }
    if (original.extras !== undefined) {
      if (!Array.isArray(original.extras) || original.extras.length > 100) throw new Error('补记饮水记录格式不正确。');
      record.extras = original.extras.map((item, i) => {
        if (!item || typeof item !== 'object') throw new Error('补记饮水记录格式不正确。');
        return { id: `import-${i}`, amount: validateAmount(item.amount), at: validateStamp(item.at) };
      });
    }
    output.records[date] = record;
  }
  return output;
}

function save() {
  if (!storageAvailable) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
  catch { storageAvailable = false; toast('浏览器暂时无法保存，当前页面仍可使用。请及时导出备份。'); }
}

try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) db = validateDatabase(JSON.parse(stored));
  localStorage.setItem(`${STORAGE_KEY}-check`, '1');
  localStorage.removeItem(`${STORAGE_KEY}-check`);
} catch {
  storageAvailable = false;
}

function currentMinute() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function relativeMinute(date) {
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86400000) * 1440 + currentMinute();
}

function planFor(date) {
  const day = structuredClone(content.days.find(item => item.weekday === weekday(date)));
  const previous = recordFor(addDays(date, -1)).report || {};
  const current = recordFor(date).report || {};
  const reasons = [];
  for (const meal of day.meals) if (db.settings.mealTimes[meal.id]) meal.time = db.settings.mealTimes[meal.id];
  if (previous.tomorrow === 'late') {
    const snack = day.meals.find(meal => meal.id === 'snack');
    const dinner = day.meals.find(meal => meal.id === 'dinner');
    snack.time = '15:30';
    snack.note += ' 昨日反馈预计今天加班，先在下午准备好加餐；如果现在不饿，可以留到需要时吃。';
    dinner.time = laterTime(dinner.time, '20:30');
    reasons.push({ title: '按昨天的加班安排调整饭点', text: '下午加餐提前到 15:30，晚餐安排到 20:30 或你设定的更晚时间。加班结束时间变化时，随实际情况调整。' });
  }
  const mealConcern = current.regular === 'missed' || previous.regular === 'missed' || ['hungry', 'very'].includes(current.hunger) || ['hungry', 'very'].includes(previous.hunger);
  if (mealConcern) {
    for (const meal of day.meals.filter(item => ['lunch', 'dinner'].includes(item.id))) meal.note += ' 近期反馈有漏餐或明显饥饿，今天保留足量主食和蛋白质食物，仍饿可以增加。';
    day.meals.find(meal => meal.id === 'snack').note += ' 提前带好，避免两餐间隔太久。';
    reasons.push({ title: '根据饥饿或漏餐反馈补足进食安排', text: '午晚餐增加足量主食和蛋白质食物的提示，并保留下午加餐机会。分量随真实饥饿感调整。' });
  }
  if (current.control === 'yes' || previous.control === 'yes') {
    reasons.push({ title: '吃得难以停下后，仍然正常进餐', text: '今天与下一天的三餐照常保留，按需要加餐。计划不会因这条反馈减少食物、跳餐或要求额外运动。' });
    day.everydaySupport = '下一餐照常、足量地吃。若这种情况反复出现或让你难受，可寻求熟悉进食问题的专业人员支持。';
  }
  const effectiveSleep = current.sleep ?? previous.sleep;
  if ((typeof effectiveSleep === 'number' && effectiveSleep < 6) || (current.energy ?? previous.energy) === 'tired') {
    day.task = { title: '今天给休息留一点位置', detail: '先做轻松走动或舒展，能休息时就休息。活动以舒服为准，给睡眠留时间。' };
    reasons.push({ title: '根据睡眠与精力反馈放轻今天的任务', text: '今日小任务已改成休息与轻松活动，饮食仍然保持正常。' });
  }
  if (previous.tomorrow === 'social') reasons.push({ title: '按昨天反馈保留聚餐安排', text: '聚餐前的早餐、午餐照常吃；聚餐较晚时先吃加餐，下一餐继续原来的节奏。' });
  day.reasons = reasons;
  day.advice = getAdvice(current, previous);
  return day;
}

function dateNav() {
  return `<div class="date-nav"><button type="button" class="today-link" data-action="shift-day" data-step="-1" aria-label="前一天">前一天</button><input type="date" id="selected-date" value="${selectedDate}" aria-label="选择查看日期"><button type="button" class="today-link" data-action="shift-day" data-step="1" aria-label="后一天">后一天</button><button type="button" class="today-link" data-action="go-today">今天</button></div>`;
}

function dateStrip() {
  return `<div class="week-strip" aria-label="本周日期">${weekDates(selectedDate).map(date => `<button type="button" class="date-button ${date === today ? 'is-today' : ''} ${date === selectedDate ? 'selected' : ''}" data-action="select-date" data-date="${date}" aria-pressed="${date === selectedDate}"><span>${date === today ? '今天' : DAY_NAMES[weekday(date) - 1]}</span><b>${Number(date.slice(-2))}</b></button>`).join('')}</div>`;
}

function sources() {
  const items = [...content.sources,
    { title: '中国疾控中心：少量多次饮水与成人饮水参考量', url: 'https://ncrwstg.chinacdc.cn/kpyd/202405/t20240511_277787.htm' },
    { title: 'NICE：规律进食与进食问题的专业支持', url: 'https://www.nice.org.uk/guidance/ng69/chapter/Recommendations' },
  ];
  return `<details class="sources"><summary>查看饮食与饮水参考</summary>${items.filter(item => /^https:\/\//.test(item.url)).map(item => `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>`).join('')}</details>`;
}

function footer() {
  return `${!storageAvailable ? '<p class="fallback-error">当前浏览器无法持久保存记录。本次打开仍可使用，请及时在设置中导出备份。</p>' : ''}<p class="footer-note">食谱按周轮换，反馈按规则调整。日期使用北京时间。记录仅保存在本浏览器，不上传；换手机或浏览器需导出、导入备份。关闭网页不会触发系统闹钟。</p>${sources()}`;
}

function mealHTML(meal, date = selectedDate) {
  const record = recordFor(date);
  const done = !!record.meals?.[meal.id];
  const alternative = !!record.alternatives?.[meal.id];
  return `<article class="meal ${done ? 'done' : ''}"><div class="meal-top"><div><div class="meal-time">${esc(meal.time)} · ${esc(MEAL_NAMES[meal.id])}</div><h3>${alternative ? '今天用方便的替换' : esc(meal.title)}</h3></div><button type="button" class="check-button" data-action="meal-check" data-id="${esc(meal.id)}" aria-pressed="${done}" ${isFuture(date) ? 'disabled' : ''}>${done ? '已吃 ✓' : '已吃'}</button></div>${alternative ? `<div class="alt-box">${esc(meal.alternative)}</div>` : `<ul class="meal-items">${list(meal.items)}</ul>`}<p class="meal-note">${esc(meal.note)}</p><button type="button" class="text-button" data-action="meal-alternative" data-id="${esc(meal.id)}">${alternative ? '换回原菜单' : '换个方便的吃法'}</button></article>`;
}

function adviceHTML(advice) {
  return advice.map(item => `<div class="advice-row"><strong>${esc(item.title)}</strong><p>${esc(item.text)}</p></div>`).join('');
}

function waterState(date = selectedDate) {
  const schedule = buildWaterSchedule(db.settings);
  const record = recordFor(date);
  const checks = record.water || {};
  const extras = record.extras || [];
  const total = Object.values(checks).reduce((sum, item) => sum + item.amount, 0) + extras.reduce((sum, item) => sum + item.amount, 0);
  const minute = relativeMinute(date);
  const next = schedule.find(item => item.minute >= minute && !checks[item.id]);
  const latestDue = [...schedule].reverse().find(item => item.minute <= minute && !checks[item.id]);
  const suggested = next || (date === today && minute <= schedule.at(-1).minute + 60 ? latestDue : null);
  return { schedule, checks, extras, total, minute, next, suggested };
}

function waterMini() {
  const water = waterState();
  const hint = water.next ? `下一次参考：${water.next.time}，${water.next.amount} 毫升` : '今天的时间表已结束，之后按口渴情况饮水。';
  return `<section class="panel water-panel" id="water-mini"><div class="water-header"><h2>慢慢喝水</h2><span class="pill">${esc(dateLabel(selectedDate))}</span></div><div class="water-amount">${water.total}<small> / ${db.settings.goal} 毫升参考量</small></div><div class="water-bar" aria-hidden="true"><i style="width:${Math.min(100, water.total / db.settings.goal * 100)}%"></i></div><p class="water-next">${esc(hint)}</p><button type="button" class="secondary full" data-action="open-water">看喝水时间表</button><p class="local-note">漏过一个时点不用补喝整杯，按实际饮水记录。</p></section>`;
}

function renderToday() {
  const plan = planFor(selectedDate);
  const [, month, day] = selectedDate.split('-');
  const nowMinute = selectedDate === today ? currentMinute() : -1;
  const nextMeal = plan.meals.find(meal => minuteOf(meal.time) >= nowMinute && !recordFor(selectedDate).meals?.[meal.id]);
  return `<section class="hero"><div class="date-block"><div class="calendar-leaf"><small>${Number(month)} 月</small><b>${Number(day)}</b><small>${DAY_NAMES[weekday(selectedDate) - 1]}</small></div><div><h1>${selectedDate === today ? '今天，好好吃饭' : `${Number(month)}月${Number(day)}日的餐桌`}</h1><p>${esc(plan.theme)}。${esc(content.intro)}</p><div class="hero-links"><span class="pill">北京时间</span><button type="button" class="text-button" data-action="go-report">记下今天的情况</button></div></div></div><div class="plate-illustration" aria-hidden="true"></div></section>${dateNav()}${dateStrip()}${isFuture(selectedDate) ? '<p class="note-banner">这是未来一天的计划，可以预览；已吃、饮水与反馈等实际记录要到当天再填写。</p>' : ''}<div class="two-col today-layout"><section><div class="section-title"><h2>这一天怎么吃</h2><span class="muted">分量随饥饿感调整</span></div>${nextMeal ? `<div class="next-meal"><small>${selectedDate === today ? '接下来的一餐' : '从这一餐开始'} · ${esc(nextMeal.time)}</small><strong>${esc(nextMeal.title)}</strong></div>` : '<div class="next-meal"><small>今晚也照顾好自己</small><strong>明显饿了，可以正常加餐</strong></div>'}${plan.meals.map(meal => mealHTML(meal)).join('')}<details class="pot-recipe"><summary><strong>电煮锅做法：${esc(plan.potRecipe.title)}</strong></summary><ul class="meal-items">${list(plan.potRecipe.ingredients)}</ul><ol>${list(plan.potRecipe.steps)}</ol></details><div class="note-banner"><strong>忙的时候也有办法</strong><p>${esc(plan.busyPlan)}</p></div><details class="pot-recipe"><summary><strong>${esc(content.portionGuide.title)}</strong></summary><p class="help-text">${esc(content.portionGuide.mainMeal)}</p><p class="help-text">${esc(content.portionGuide.proteinNote)}</p><p class="help-text">只选择自己可以安全食用的食材；已知过敏或特殊忌口请自行替换。</p></details></section><aside class="sidebar">${waterMini()}<section class="panel"><h2>今天的一件小事</h2><label class="task"><input type="checkbox" data-action="task-check" ${recordFor(selectedDate).task ? 'checked' : ''} ${isFuture(selectedDate) ? 'disabled' : ''}><span>${esc(plan.task.title)}<small>${esc(plan.task.detail)}</small></span></label></section><section class="panel"><div class="section-title"><h2>适合今天的安排</h2><button type="button" class="text-button" data-action="go-report">填反馈</button></div>${adviceHTML(plan.advice)}${plan.reasons.length ? `<details class="pot-recipe" open><summary><strong>为什么这样调整</strong></summary>${adviceHTML(plan.reasons)}</details>` : '<p class="local-note">提交每日反馈后，这里会显示调整与原因。</p>'}</section></aside></div>${footer()}`;
}

function renderWeek() {
  const dates = weekDates(selectedDate);
  return `<section class="page-heading"><h1>这一周，吃得顺一点</h1><p class="page-intro">${esc(dateLabel(dates[0]))} 至 ${esc(dateLabel(dates[6]))}。每天都能换菜，忙的时候直接用替换选项。</p></section><div class="date-nav"><button type="button" class="today-link" data-action="shift-day" data-step="-7">上一周</button><button type="button" class="today-link" data-action="go-today">回到本周</button><button type="button" class="today-link" data-action="shift-day" data-step="7">下一周</button></div>${dates.map(date => { const plan = planFor(date); return `<details class="day-card" ${date === selectedDate ? 'open' : ''}><summary><div class="day-number"><small>${DAY_NAMES[weekday(date) - 1]}</small><b>${Number(date.slice(-2))}</b></div><div><h3>${esc(plan.theme)}${date === today ? ' · 今天' : ''}</h3><p>${esc(plan.meals.find(meal => meal.id === 'dinner').title)}</p></div></summary><div class="week-meals">${plan.meals.map(meal => `<div class="week-meal"><b>${esc(meal.time)} ${esc(MEAL_NAMES[meal.id])} · ${esc(meal.title)}</b><p>${meal.items.map(esc).join(' ＋ ')}</p><p>方便替换：${esc(meal.alternative)}</p></div>`).join('')}<p class="help-text">今日小事：${esc(plan.task.title)}</p>${plan.reasons.length ? `<div class="alt-box">${plan.reasons.map(reason => esc(reason.title)).join('；')}</div>` : ''}<button type="button" class="text-button" data-action="view-day" data-date="${date}">打开这一天的完整安排</button></div></details>`; }).join('')}<section class="panel" style="margin-top:28px"><h2>${esc(content.shopping.title)}</h2><p class="help-text">${esc(content.shopping.intro)}</p>${[...content.shopping.pantry, ...content.shopping.fresh].map(group => `<details class="pot-recipe"><summary><strong>${esc(group.name)}</strong></summary><ul class="purchase-list">${list(group.items)}</ul><p class="help-text">${esc(group.note)}</p></details>`).join('')}<p class="help-text">${content.shopping.storageNotes.map(esc).join(' ')}</p></section>${footer()}`;
}

function renderWater() {
  const water = waterState();
  const future = isFuture(selectedDate);
  return `<div class="water-page"><section class="page-heading"><h1>给喝水留一点时间</h1><p class="page-intro">分散到一天里，小口慢慢喝。下面是方便执行的参考安排，不是必须完成的额度。</p></section>${dateNav()}<section class="panel water-panel"><div class="water-header"><h2>${esc(dateLabel(selectedDate))}</h2><button type="button" class="text-button" data-action="settings">调整时间和参考量</button></div><div class="water-amount">${water.total}<small> 毫升已记录 / ${db.settings.goal} 毫升参考</small></div><div class="water-bar" aria-hidden="true"><i style="width:${Math.min(100, water.total / db.settings.goal * 100)}%"></i></div><p class="water-next">${water.next ? `下一次参考：${water.next.time}，${water.next.amount} 毫升` : '时间表已结束；按口渴、活动与实际需要饮水，不必补齐数字。'}</p></section>${future ? '<p class="water-tip">未来日期只预览，到了当天再记录实际喝水量。</p>' : ''}<div class="water-list">${water.schedule.map(item => { const checked = water.checks[item.id]; return `<div class="water-slot ${checked ? 'checked' : ''} ${water.next?.id === item.id ? 'current' : ''}"><div><strong>${esc(item.time)}${item.minute >= 1440 ? '<small> 次日</small>' : ''}</strong><p>${checked ? `已记录 ${checked.amount} 毫升` : `参考 ${item.amount} 毫升`}</p></div><button type="button" class="check-button" data-action="water-check" data-id="${item.id}" aria-pressed="${!!checked}" ${future ? 'disabled' : ''}>${checked ? '撤销' : '记录这杯'}</button></div>`; }).join('')}</div><p class="water-tip">只有实际喝了才勾选。漏过的时点不会变成“欠水”；如果喝的量与整杯参考量不同，请用下面的补记，避免重复记录。修改设置不会改写已经喝下的实际量。</p><section class="panel"><h2>补记实际喝的一杯</h2><p class="help-text">用于时间表之外的饮水，或与参考杯量不同的一杯。</p><div class="row" style="margin-top:14px">${[100, 200, 250].map(amount => `<button type="button" class="secondary" data-action="water-extra" data-amount="${amount}" ${future ? 'disabled' : ''}>＋${amount} 毫升</button>`).join('')}</div>${water.extras.length ? `<div class="history">${water.extras.map((item, index) => `<div class="row"><p>补记第 ${index + 1} 杯：${item.amount} 毫升</p><button type="button" class="text-button" data-action="water-extra-remove" data-id="${esc(item.id)}">撤销</button></div>`).join('')}</div>` : ''}</section><div class="note-banner"><strong>按身体需要灵活调整</strong><p>1700 毫升参考量适用于温和气候、低活动量的成年男性。水、淡茶等都能补水；奶和食物也含水。出汗、炎热或运动时需要相应调整，不用强迫自己一次喝很多。若医生要求限水，请以医嘱为准；本页通用设置不适用于限水治疗。</p><p>喝水安排也不替代正餐，不用靠大量喝水压住饥饿。</p></div>${footer()}</div>`;
}

const options = (items, selected, placeholder = '请选择') => `<option value="" ${selected === undefined || selected === '' ? 'selected' : ''} disabled>${placeholder}</option>${items.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('')}`;

function renderReport() {
  const report = recordFor(selectedDate).report || {};
  const plan = planFor(selectedDate);
  const future = isFuture(selectedDate);
  const history = Object.keys(db.records).filter(date => db.records[date].report).sort().reverse().slice(0, 7);
  return `<div class="report-page"><section class="page-heading"><h1>今天过得怎么样</h1><p class="page-intro">花一分钟记下真实情况。提交后，今天的建议立即更新；明天的菜单会结合今天的反馈调整，并说明原因。</p></section>${dateNav()}<p class="feedback-date">正在记录：${esc(dateLabel(selectedDate))}${future ? '（未来日期暂不能填写实际反馈）' : ''}</p><section class="panel"><form id="report-form"><fieldset ${future ? 'disabled' : ''} style="border:0;padding:0;margin:0"><div class="form-grid"><label class="field"><span>今天三餐大致规律吗？</span><select name="regular" required>${options([['yes', '基本规律'], ['missed', '有漏餐，或拖到很晚才吃']], report.regular)}</select></label><label class="field"><span>晚饭前的饥饿感</span><select name="hunger" required>${options([['comfortable', '舒服，饿得不厉害'], ['hungry', '比较饿'], ['very', '饿得难受，很想赶快吃']], report.hunger)}</select></label><label class="field"><span>昨晚到今天共睡了多久？</span><input name="sleep" type="number" min="0" max="24" step="0.5" inputmode="decimal" placeholder="例如 6.5" value="${report.sleep ?? ''}" required><small>包括午睡，估计即可。</small></label><label class="field"><span>今天的精力</span><select name="energy" required>${options([['fine', '总体还可以'], ['tired', '比较疲惫或困倦']], report.energy)}</select></label><label class="field"><span>吃饭时有没有想停却停不下来的情况？</span><select name="control" required>${options([['no', '没有'], ['yes', '有'], ['skip', '今天先不回答']], report.control ?? 'skip')}</select><small>用于安排支持，不用于诊断，也不会因此减少下一餐。</small></label><label class="field"><span>明天的安排</span><select name="tomorrow" required>${options([['normal', '普通工作或休息日'], ['late', '可能加班或很晚才能吃晚饭'], ['social', '有聚餐或外出安排']], report.tomorrow)}</select></label></div><div class="form-actions"><button type="submit" class="primary">保存反馈并调整安排</button>${report.savedAt ? '<span class="saved-state">这一天已保存，可以继续修改</span>' : ''}</div></fieldset></form><p class="local-note">这些答案只在当前浏览器保存。页面按可查看的规则调整，不会调用网络 AI 或上传记录。</p></section>${report.savedAt ? `<section class="panel report-result"><h2>已根据反馈调整</h2>${adviceHTML(plan.advice)}${plan.reasons.length ? `<details class="pot-recipe" open><summary><strong>菜单的实际变化</strong></summary>${adviceHTML(plan.reasons)}</details>` : ''}<div class="row" style="margin-top:15px"><button type="button" class="secondary" data-action="open-today-plan">看当天安排</button><button type="button" class="secondary" data-action="view-day" data-date="${addDays(selectedDate, 1)}">看次日安排</button></div></section>` : ''}<details class="pot-recipe"><summary><strong>反馈怎样改变计划</strong></summary><ul class="purchase-list"><li>漏餐或明显饥饿：补充足量正餐和加餐提示。</li><li>预计次日加班：次日加餐提前到 15:30，晚餐延至 20:30 或你的更晚饭点。</li><li>睡眠少于 6 小时或疲惫：当天小任务改为休息与轻松活动。</li><li>吃饭时难以停下：保留正常三餐，提示专业支持，不做惩罚性调整。</li><li>预计次日聚餐：前面的餐食照常安排。</li></ul></details>${history.length ? `<section class="panel" style="margin-top:24px"><h2>最近的反馈</h2>${history.map(date => `<div class="history row"><p>${esc(dateLabel(date))} · 睡眠 ${esc(db.records[date].report.sleep ?? '未填')} 小时</p><button type="button" class="text-button" data-action="edit-report" data-date="${date}">查看 / 修改</button></div>`).join('')}</section>` : ''}${footer()}</div>`;
}

function render({ focus = false } = {}) {
  if (!content) return;
  reportDirty = false;
  const renders = { today: renderToday, week: renderWeek, water: renderWater, report: renderReport };
  app.innerHTML = renders[tab]();
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (focus) app.focus({ preventScroll: true });
}

function showModal(html) {
  modalBody.innerHTML = html;
  if (!modal.open) modal.showModal();
}

function showShare() {
  showModal(`<div class="modal-heading"><h2>手机扫码，打开今天</h2><button type="button" data-action="close-modal" aria-label="关闭">×</button></div><p class="help-text">无需登录，手机浏览器打开即可。每次进入默认显示北京时间当天的食谱。</p><img class="qr-image" src="./qr.png" alt="扫描二维码打开好好吃饭网站" width="280" height="280"><a class="qr-link" href="${SITE_URL}" target="_blank" rel="noopener noreferrer">${SITE_URL}</a><div class="modal-actions row"><button type="button" class="primary" data-action="copy-link">复制链接</button><a href="./qr.png" download="好好吃饭二维码.png" class="secondary">保存二维码</a></div><p class="help-text">也可以在手机浏览器菜单选择“添加到主屏幕”。每天用同一个浏览器打开，方便保留反馈和打卡。</p>`);
}

function showSettings() {
  const settings = db.settings;
  showModal(`<div class="modal-heading"><h2>配合你的生活节奏</h2><button type="button" data-action="close-modal" aria-label="关闭">×</button></div><form id="settings-form"><div class="settings-fields"><label class="field"><span>通常起床时间</span><input type="time" name="wake" value="${esc(settings.wake)}" required></label><label class="field"><span>通常睡觉时间</span><input type="time" name="bed" value="${esc(settings.bed)}" required></label><label class="field wide"><span>每日饮水参考量</span><select name="goal">${[1500, 1700, 1800, 2000].map(goal => `<option value="${goal}" ${settings.goal === goal ? 'selected' : ''}>${goal} 毫升${goal === 1700 ? '（默认参考）' : ''}</option>`).join('')}</select><small>分成八次，从起床后半小时到睡前两小时；参考量不是强制任务。</small></label>${Object.entries(MEAL_NAMES).map(([id, label]) => `<label class="field"><span>${label}时间</span><input type="time" name="meal-${id}" value="${esc(settings.mealTimes[id] || '')}"><small>留空使用当天菜单默认时间。</small></label>`).join('')}</div><p class="help-text">日期与饭点按北京时间显示。加班反馈会把次日加餐提前到 15:30，晚餐延到 20:30 或更晚的自定义时间。</p><p class="help-text">若医生要求限制饮水，请按医嘱安排，本页通用参考不替代个体医疗建议。</p><div class="modal-actions"><button type="submit" class="primary full">保存设置</button></div><p id="settings-error" class="help-text danger" role="alert"></p></form><hr class="subtle-divider"><h3>我的记录</h3><p class="help-text">记录仅在本浏览器。导出备份可以带到另一台手机；导入会替换当前记录。</p><div class="modal-actions row"><button type="button" class="secondary" data-action="export">导出备份</button><button type="button" class="secondary" data-action="import">导入备份</button><button type="button" class="text-button danger" data-action="clear-data">清除本地记录</button></div><input type="file" id="import-file" accept="application/json,.json" hidden><p class="help-text">导出的文件包含你填写的每日反馈，请自行妥善保存。</p>`);
}

function confirmLeave() {
  return !reportDirty || window.confirm('这份反馈还没有保存。确定离开吗？');
}

function selectDate(date, nextTab = tab) {
  if (!validDate(date)) { toast('请选择有效日期。'); return; }
  if (!confirmLeave()) return;
  selectedDate = date;
  followsToday = date === today;
  tab = nextTab;
  history.replaceState(null, '', `#${tab}`);
  render();
}

function selectTab(nextTab) {
  if (!['today', 'week', 'water', 'report'].includes(nextTab) || !confirmLeave()) return;
  tab = nextTab;
  history.replaceState(null, '', `#${tab}`);
  render({ focus: true });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function allowActual() {
  if (isFuture(selectedDate)) { toast('未来日期只可预览，请到当天再填写实际记录。'); return false; }
  return true;
}

function exportBackup() {
  const blob = new Blob([JSON.stringify({ ...db, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `好好吃饭备份-${today}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('备份已准备，请保存到安全的位置。');
}

async function importBackup(file) {
  if (!file) return;
  if (file.size > 2_000_000) { toast('备份文件过大，请选择本页面导出的 JSON 文件。'); return; }
  try {
    const imported = validateDatabase(JSON.parse(await file.text()));
    if (!window.confirm(`将导入 ${Object.keys(imported.records).length} 天记录并替换当前记录，确定继续吗？`)) return;
    db = imported;
    save();
    modal.close();
    render();
    toast('备份已导入。');
  } catch (error) { toast(`未导入：${error.message}`); }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button, a');
  if (!button) return;
  if (button.matches('.brand')) { event.preventDefault(); if (confirmLeave()) { selectedDate = today; followsToday = true; tab = 'today'; history.replaceState(null, '', '#today'); render(); } return; }
  if (button.dataset.tab) { selectTab(button.dataset.tab); return; }
  if (button.id === 'share-button') { showShare(); return; }
  if (button.id === 'settings-button') { showSettings(); return; }
  const action = button.dataset.action;
  if (!action) return;
  if (action === 'close-modal') { modal.close(); return; }
  if (action === 'settings') { showSettings(); return; }
  if (action === 'go-today') { selectDate(today); return; }
  if (action === 'shift-day') { selectDate(addDays(selectedDate, Number(button.dataset.step))); return; }
  if (action === 'select-date') { selectDate(button.dataset.date); return; }
  if (action === 'view-day') { selectDate(button.dataset.date, 'today'); window.scrollTo({ top: 0, behavior: 'auto' }); return; }
  if (action === 'edit-report') { selectDate(button.dataset.date, 'report'); return; }
  if (action === 'open-today-plan') { selectTab('today'); return; }
  if (action === 'open-water') { selectTab('water'); return; }
  if (action === 'go-report') { if (isFuture(selectedDate)) selectDate(today, 'report'); else selectTab('report'); return; }
  if (action === 'copy-link') {
    try { await navigator.clipboard.writeText(SITE_URL); toast('链接已复制。'); }
    catch { toast('浏览器未允许复制，请长按上面的链接复制。'); }
    return;
  }
  if (action === 'export') { exportBackup(); return; }
  if (action === 'import') { document.querySelector('#import-file').click(); return; }
  if (action === 'clear-data') {
    if (!window.confirm('确定清除本浏览器的全部打卡和每日反馈吗？建议先导出备份。作息设置将保留。')) return;
    db.records = {};
    save();
    modal.close();
    render();
    toast('本浏览器的记录已清除，设置已保留。');
    return;
  }
  if (action === 'meal-alternative') {
    if (!Object.hasOwn(MEAL_NAMES, button.dataset.id)) return;
    if (isFuture(selectedDate)) {
      const article = button.closest('.meal');
      const meal = planFor(selectedDate).meals.find(item => item.id === button.dataset.id);
      const shown = article.querySelector('.alt-preview');
      if (shown) { shown.remove(); button.textContent = '换个方便的吃法'; }
      else { const preview = document.createElement('div'); preview.className = 'alt-box alt-preview'; preview.textContent = meal.alternative; button.before(preview); button.textContent = '收起替换选项'; }
      return;
    }
    const record = ensureRecord(selectedDate);
    record.alternatives ||= {};
    record.alternatives[button.dataset.id] = !record.alternatives[button.dataset.id];
    save(); render(); return;
  }
  if (action === 'meal-check') {
    if (!allowActual() || !Object.hasOwn(MEAL_NAMES, button.dataset.id)) return;
    const record = ensureRecord(selectedDate); record.meals ||= {};
    record.meals[button.dataset.id] = !record.meals[button.dataset.id];
    save(); render(); return;
  }
  if (action === 'water-check') {
    if (!allowActual()) return;
    const slot = buildWaterSchedule(db.settings).find(item => item.id === button.dataset.id);
    if (!slot) return;
    const record = ensureRecord(selectedDate); record.water ||= {};
    if (record.water[slot.id]) { delete record.water[slot.id]; toast('已撤销这杯记录。'); }
    else { record.water[slot.id] = { amount: slot.amount, at: new Date().toISOString() }; toast(`已记录实际饮水 ${slot.amount} 毫升。`); }
    save(); render(); return;
  }
  if (action === 'water-extra') {
    if (!allowActual()) return;
    const amount = Number(button.dataset.amount);
    if (![100, 200, 250].includes(amount)) return;
    const record = ensureRecord(selectedDate); record.extras ||= [];
    if (record.extras.length >= 100) { toast('今天的补记条目已达到上限，请先检查是否有重复记录。'); return; }
    record.extras.push({ id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, amount, at: new Date().toISOString() });
    save(); render(); toast(`已补记 ${amount} 毫升。`); return;
  }
  if (action === 'water-extra-remove') {
    if (!allowActual()) return;
    const record = ensureRecord(selectedDate);
    record.extras = (record.extras || []).filter(item => item.id !== button.dataset.id);
    save(); render(); toast('已撤销补记。');
  }
});

document.addEventListener('change', event => {
  if (event.target.id === 'selected-date') { selectDate(event.target.value); return; }
  if (event.target.id === 'import-file') { importBackup(event.target.files?.[0]); return; }
  if (event.target.dataset.action === 'task-check') {
    if (!allowActual()) return;
    ensureRecord(selectedDate).task = event.target.checked;
    save();
  }
  if (event.target.closest('#report-form')) reportDirty = true;
});
document.addEventListener('input', event => { if (event.target.closest('#report-form')) reportDirty = true; });

document.addEventListener('submit', event => {
  if (event.target.id === 'report-form') {
    event.preventDefault();
    if (!allowActual()) return;
    const form = new FormData(event.target);
    try {
      const report = validateReport({ regular: form.get('regular'), hunger: form.get('hunger'), sleep: Number(form.get('sleep')), energy: form.get('energy'), control: form.get('control'), tomorrow: form.get('tomorrow'), savedAt: new Date().toISOString() });
      ensureRecord(selectedDate).report = report;
      save();
      render();
      toast('已保存，今天的建议和次日安排已更新。');
      document.querySelector('.report-result')?.scrollIntoView({ behavior: 'auto', block: 'start' });
    } catch (error) { toast(error.message); }
  }
  if (event.target.id === 'settings-form') {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      const settings = validateSettings({ wake: form.get('wake'), bed: form.get('bed'), goal: Number(form.get('goal')), mealTimes: Object.fromEntries(Object.keys(MEAL_NAMES).map(id => [id, form.get(`meal-${id}`)])) });
      db.settings = settings;
      save();
      modal.close();
      if (!(tab === 'report' && reportDirty)) render();
      toast('设置已更新，已有饮水记录的实际毫升数保持不变。');
    } catch (error) { document.querySelector('#settings-error').textContent = error.message; }
  }
});

window.addEventListener('hashchange', () => {
  const requested = location.hash.slice(1);
  if (['today', 'week', 'water', 'report'].includes(requested) && requested !== tab) selectTab(requested);
});
window.addEventListener('beforeunload', event => { if (reportDirty) { event.preventDefault(); event.returnValue = ''; } });

function refreshClock() {
  if (!content) return;
  const newToday = dateKey();
  const changed = newToday !== today;
  if (changed) { today = newToday; pendingDayChange = true; }
  const filling = tab === 'report' && (reportDirty || document.activeElement?.closest('#report-form'));
  if (filling || modal.open) {
    if (changed) toast('已到新的一天。先完成当前反馈，再点“今天”查看新安排。');
    return;
  }
  if (pendingDayChange) {
    if (followsToday) selectedDate = today;
    pendingDayChange = false;
    render();
    return;
  }
  // Preserve expanded recipes, input focus and scroll while updating clock hints.
  if (tab === 'today') {
    const mini = document.querySelector('#water-mini');
    if (mini && !mini.contains(document.activeElement)) mini.outerHTML = waterMini();
  } else if (tab === 'water' && !document.activeElement?.closest('.water-page button')) render();
}

setInterval(refreshClock, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshClock(); });
window.addEventListener('focus', refreshClock);

async function start() {
  try {
    const response = await fetch('./weekly-content.json');
    if (!response.ok) throw new Error('食谱文件暂时无法读取。');
    content = await response.json();
    if (!Array.isArray(content.days) || content.days.length !== 7) throw new Error('食谱内容暂不完整。');
    render();
  } catch (error) {
    app.innerHTML = `<div class="fallback-error"><h2>食谱暂时没有加载出来</h2><p>${esc(error.message)}</p><p>请检查网络后重新打开页面。你的本地记录不会因此清除。</p><button type="button" class="secondary" id="reload-page">重新加载</button></div>`;
    document.querySelector('#reload-page').addEventListener('click', () => location.reload());
  }
}

start();
