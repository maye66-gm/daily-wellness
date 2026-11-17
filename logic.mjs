/** Date and planning rules shared by the browser UI and Node verification. */
const DAY_MS = 86_400_000;
const WATER_GOALS = new Set([1500, 1700, 1800, 2000]);

function parseDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new RangeError('日期需要使用 YYYY-MM-DD 格式。');
  }
  const date = new Date(`${key}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== key) {
    throw new RangeError('这个日期不存在。');
  }
  return date;
}

export function dateKey(now = new Date(), timeZone = 'Asia/Shanghai') {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new RangeError('无法读取当前日期。');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(key, n) {
  if (!Number.isInteger(n)) throw new RangeError('日期偏移需要是整数天。');
  return new Date(parseDateKey(key).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

export function weekday(key) {
  return parseDateKey(key).getUTCDay() || 7;
}

export function weekDates(key) {
  const monday = addDays(key, 1 - weekday(key));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function clockMinute(value, label) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new RangeError(`${label}时间需要使用有效的 HH:mm 格式。`);
  }
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function clockText(minute) {
  const withinDay = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(withinDay / 60)).padStart(2, '0')}:${String(withinDay % 60).padStart(2, '0')}`;
}

/**
 * Eight flexible drinking opportunities, not mandatory intake or missed quotas.
 * Minute is relative to the wake-date, so values over 1440 mean the next date.
 */
export function buildWaterSchedule({ wake = '07:00', bed = '23:00', goal = 1700 } = {}) {
  if (!WATER_GOALS.has(goal)) {
    throw new RangeError('饮水参考量请选择 1500、1700、1800 或 2000 毫升。');
  }
  const wakeMinute = clockMinute(wake, '起床');
  let bedMinute = clockMinute(bed, '睡觉');
  if (bedMinute === wakeMinute) throw new RangeError('起床和睡觉时间不能相同。');
  if (bedMinute < wakeMinute) bedMinute += 1440;
  const start = wakeMinute + 30;
  const end = bedMinute - 120;
  if (end - start < 210) {
    throw new RangeError('这组作息太短，无法合理分散安排八次饮水，请检查起床和睡觉时间。');
  }
  const units = goal / 25;
  // Rounded cumulative allocations distribute extra 25 mL units evenly.
  return Array.from({ length: 8 }, (_, i) => {
    const exactMinute = start + ((end - start) * i) / 7;
    const minute = i === 0 ? start : i === 7 ? end : Math.round(exactMinute / 5) * 5;
    const amount = (Math.round((units * (i + 1)) / 8) - Math.round((units * i) / 8)) * 25;
    return { id: `water-${i}`, time: clockText(minute), amount, minute };
  });
}

/** Explicit, conservative rules; no diagnosis, calories or automatic restriction. */
export function getAdvice(report = {}, previous = {}) {
  const current = report && typeof report === 'object' ? report : {};
  const prior = previous && typeof previous === 'object' ? previous : {};
  const advice = [];
  const controlConcern = current.control === 'yes' || prior.control === 'yes';
  const repeatedConcern = current.control === 'yes' && prior.control === 'yes';
  const regular = current.regular ?? prior.regular;
  const hunger = current.hunger ?? prior.hunger;
  const sleepValue = current.sleep ?? prior.sleep;
  const sleep = typeof sleepValue === 'number' && Number.isFinite(sleepValue) ? sleepValue : undefined;
  const energy = current.energy ?? prior.energy;

  if (controlConcern) {
    advice.push({
      kind: 'food',
      title: '下一餐继续正常吃',
      text: '今天和下一天都保留正常、足量的三餐，提前准备加餐。吃多之后照常进餐，把当时的饥饿、疲惫或情绪记下来，帮助调整安排。',
    });
    advice.push({
      kind: 'care',
      title: repeatedConcern ? '给反复出现的困扰一些支持' : '认真照顾进食时的感受',
      text: repeatedConcern
        ? '最近两次反馈都提到进食时难以停下。建议预约熟悉进食问题的医生或营养专业人员，评估后一起安排后续计划。'
        : '这条反馈不能用来诊断。如果进食时难以停下反复发生，或让你明显难受、自责，可以预约熟悉进食问题的专业人员。',
    });
  }

  if (regular === 'missed' || hunger === 'hungry' || hunger === 'very') {
    advice.push({
      kind: 'food',
      title: regular === 'missed' ? '把漏掉的一餐接回来' : '给下一顿留足分量',
      text: regular === 'missed'
        ? '下一天提前准备能带走的早餐，午晚餐保留主食、蛋白质食物和蔬菜。两餐间隔较长时安排加餐，尽量在饿得难受之前吃到东西。'
        : '正餐吃到舒服、满足；如果吃完仍饿，可以增加主食或蛋白质食物。晚饭较晚时，在下午安排奶或豆浆搭配水果、面包等加餐。',
    });
  }

  if (prior.tomorrow === 'late' || current.tomorrow === 'late') {
    const when = prior.tomorrow === 'late' && current.tomorrow === 'late'
      ? '今天和明天都有晚下班安排'
      : prior.tomorrow === 'late' ? '根据昨天的反馈，今天可能晚下班' : '你预计明天会晚下班';
    advice.push({
      kind: 'food',
      title: prior.tomorrow === 'late' ? '今天先备好下午加餐' : '明天加班，提前备餐',
      text: `${when}。下午先留出一个吃加餐的间隙，准备奶或豆浆、面包、水果等方便取得的食物，晚餐继续正常安排。`,
    });
  }

  if (prior.tomorrow === 'social' || current.tomorrow === 'social') {
    advice.push({
      kind: 'food',
      title: prior.tomorrow === 'social' ? '今天聚餐，前面照常吃' : '明天聚餐，保留正常三餐',
      text: '聚餐前照常吃早餐、午餐，时间较晚时先安排加餐。聚餐中选喜欢的食物，留意饥饿和满足感，下一餐恢复平常的进食节奏。',
    });
  }

  if ((sleep !== undefined && sleep >= 0 && sleep < 6) || energy === 'tired') {
    advice.push({
      kind: 'rest',
      title: '今天给休息留一点位置',
      text: '反馈显示睡眠不足或比较疲惫。活动以轻松走动、舒展为主，尽量给休息留出时间。如果困倦明显，避免驾驶等需要持续警觉的操作；困倦反复影响生活时请就医评估。',
    });
  }

  if (advice.length === 0) {
    advice.push({
      kind: 'food',
      title: '继续舒服、规律地吃',
      text: '按今天的食谱安排三餐，分量随实际饥饿和满足感调整。需要时加餐，给自己一个从容吃饭的间隙。',
    });
  }
  return advice;
}
