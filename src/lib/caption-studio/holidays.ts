/**
 * The holiday library (E-SOC-19): public holidays and well-known observances
 * per country, with every date COMPUTED from the rule that defines it — "the
 * fourth Thursday in November", "Easter Sunday less two days" — never typed in
 * for a year, so it is right for whatever year is asked. The doc's step 1
 * ("check whether the dates have changed") is what the rule does.
 *
 * ⚠ A rule is not a decree. Governments occasionally move a bank holiday for
 * one year (a jubilee, a coronation); the library can't know that, so the page
 * shows each day's rule beside it. Regional holidays are named as such.
 */

export type HolidayCountry = "us" | "gb" | "ca" | "au" | "intl";

export const HOLIDAY_COUNTRIES: ReadonlyArray<{ code: HolidayCountry; name: string }> = [
  { code: "us", name: "United States" },
  { code: "gb", name: "United Kingdom" },
  { code: "ca", name: "Canada" },
  { code: "au", name: "Australia" },
  { code: "intl", name: "International days" },
];

export function isHolidayCountry(v: unknown): v is HolidayCountry {
  return typeof v === "string" && HOLIDAY_COUNTRIES.some((c) => c.code === v);
}

export type Holiday = { key: string; name: string; kind: "public holiday" | "observance"; rule: string; date: string };

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORD = ["", "first", "second", "third", "fourth"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const weekdayOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The n-th (1–4) given weekday (0 = Sunday) of a month. */
export function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  const first = weekdayOf(y, m, 1);
  return ymd(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

/** The last given weekday of a month. */
export function lastWeekday(y: number, m: number, weekday: number): string {
  const last = daysIn(y, m);
  return ymd(y, m, last - ((weekdayOf(y, m, last) - weekday + 7) % 7));
}

/** Western (Gregorian) Easter Sunday — the anonymous Gregorian computus. */
export function easterSunday(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

type Rule = { text: string; date: (y: number) => string };
const fixed = (m: number, d: number): Rule => ({ text: `${MONTH[m - 1]} ${d}`, date: (y) => ymd(y, m, d) });
const nth = (n: number, wd: number, m: number): Rule => ({ text: `${ORD[n]} ${DAY[wd]} in ${MONTH[m - 1]}`, date: (y) => nthWeekday(y, m, wd, n) });
const last = (wd: number, m: number): Rule => ({ text: `last ${DAY[wd]} in ${MONTH[m - 1]}`, date: (y) => lastWeekday(y, m, wd) });
const easter = (offset: number, text: string): Rule => ({ text, date: (y) => addDays(easterSunday(y), offset) });
const usThanksgiving = (y: number) => nthWeekday(y, 11, 4, 4);
const afterThanksgiving = (offset: number, text: string): Rule => ({ text, date: (y) => addDays(usThanksgiving(y), offset) });
/** The given weekday on or before a date — Canada's Victoria Day is the Monday on or before May 24. */
const onOrBefore = (m: number, d: number, wd: number, text: string): Rule => ({ text, date: (y) => addDays(ymd(y, m, d), -((weekdayOf(y, m, d) - wd + 7) % 7)) });

type Entry = { key: string; name: string; kind: Holiday["kind"]; rule: Rule };
const P = "public holiday" as const;
const O = "observance" as const;
const SUN = 0, MON = 1, THU = 4;

const LIBRARY: Record<HolidayCountry, Entry[]> = {
  us: [
    { key: "new-year", name: "New Year's Day", kind: P, rule: fixed(1, 1) },
    { key: "mlk", name: "Martin Luther King Jr. Day", kind: P, rule: nth(3, MON, 1) },
    { key: "valentines", name: "Valentine's Day", kind: O, rule: fixed(2, 14) },
    { key: "presidents", name: "Presidents' Day (Washington's Birthday)", kind: P, rule: nth(3, MON, 2) },
    { key: "st-patricks", name: "St. Patrick's Day", kind: O, rule: fixed(3, 17) },
    { key: "good-friday", name: "Good Friday", kind: O, rule: easter(-2, "two days before Easter Sunday") },
    { key: "easter", name: "Easter Sunday", kind: O, rule: easter(0, "Western Easter (the Gregorian computus)") },
    { key: "mothers-day", name: "Mother's Day", kind: O, rule: nth(2, SUN, 5) },
    { key: "memorial", name: "Memorial Day", kind: P, rule: last(MON, 5) },
    { key: "juneteenth", name: "Juneteenth", kind: P, rule: fixed(6, 19) },
    { key: "fathers-day", name: "Father's Day", kind: O, rule: nth(3, SUN, 6) },
    { key: "independence", name: "Independence Day", kind: P, rule: fixed(7, 4) },
    { key: "womens-equality", name: "Women's Equality Day", kind: O, rule: fixed(8, 26) },
    { key: "labor", name: "Labor Day", kind: P, rule: nth(1, MON, 9) },
    { key: "columbus", name: "Columbus Day / Indigenous Peoples' Day", kind: P, rule: nth(2, MON, 10) },
    { key: "halloween", name: "Halloween", kind: O, rule: fixed(10, 31) },
    { key: "veterans", name: "Veterans Day", kind: P, rule: fixed(11, 11) },
    { key: "thanksgiving", name: "Thanksgiving", kind: P, rule: nth(4, THU, 11) },
    { key: "black-friday", name: "Black Friday", kind: O, rule: afterThanksgiving(1, "the day after Thanksgiving") },
    { key: "small-business-saturday", name: "Small Business Saturday", kind: O, rule: afterThanksgiving(2, "the Saturday after Thanksgiving") },
    { key: "cyber-monday", name: "Cyber Monday", kind: O, rule: afterThanksgiving(4, "the Monday after Thanksgiving") },
    { key: "giving-tuesday", name: "Giving Tuesday", kind: O, rule: afterThanksgiving(5, "the Tuesday after Thanksgiving") },
    { key: "christmas", name: "Christmas Day", kind: P, rule: fixed(12, 25) },
  ],
  gb: [
    { key: "new-year", name: "New Year's Day", kind: P, rule: fixed(1, 1) },
    { key: "burns-night", name: "Burns Night", kind: O, rule: fixed(1, 25) },
    { key: "st-davids", name: "St David's Day", kind: O, rule: fixed(3, 1) },
    { key: "st-patricks", name: "St Patrick's Day (bank holiday in Northern Ireland)", kind: O, rule: fixed(3, 17) },
    { key: "mothering-sunday", name: "Mothering Sunday", kind: O, rule: easter(-21, "three weeks before Easter Sunday") },
    { key: "good-friday", name: "Good Friday", kind: P, rule: easter(-2, "two days before Easter Sunday") },
    { key: "easter", name: "Easter Sunday", kind: O, rule: easter(0, "Western Easter (the Gregorian computus)") },
    { key: "easter-monday", name: "Easter Monday (not in Scotland)", kind: P, rule: easter(1, "the day after Easter Sunday") },
    { key: "st-georges", name: "St George's Day", kind: O, rule: fixed(4, 23) },
    { key: "early-may", name: "Early May bank holiday", kind: P, rule: nth(1, MON, 5) },
    { key: "spring", name: "Spring bank holiday", kind: P, rule: last(MON, 5) },
    { key: "fathers-day", name: "Father's Day", kind: O, rule: nth(3, SUN, 6) },
    { key: "summer", name: "Summer bank holiday (England, Wales, Northern Ireland)", kind: P, rule: last(MON, 8) },
    { key: "halloween", name: "Halloween", kind: O, rule: fixed(10, 31) },
    { key: "bonfire", name: "Bonfire Night", kind: O, rule: fixed(11, 5) },
    { key: "remembrance-sunday", name: "Remembrance Sunday", kind: O, rule: nth(2, SUN, 11) },
    { key: "armistice", name: "Armistice Day", kind: O, rule: fixed(11, 11) },
    { key: "st-andrews", name: "St Andrew's Day", kind: O, rule: fixed(11, 30) },
    { key: "christmas", name: "Christmas Day", kind: P, rule: fixed(12, 25) },
    { key: "boxing", name: "Boxing Day", kind: P, rule: fixed(12, 26) },
  ],
  ca: [
    { key: "new-year", name: "New Year's Day", kind: P, rule: fixed(1, 1) },
    { key: "family", name: "Family Day (most provinces)", kind: P, rule: nth(3, MON, 2) },
    { key: "valentines", name: "Valentine's Day", kind: O, rule: fixed(2, 14) },
    { key: "good-friday", name: "Good Friday", kind: P, rule: easter(-2, "two days before Easter Sunday") },
    { key: "easter", name: "Easter Sunday", kind: O, rule: easter(0, "Western Easter (the Gregorian computus)") },
    { key: "easter-monday", name: "Easter Monday", kind: O, rule: easter(1, "the day after Easter Sunday") },
    { key: "mothers-day", name: "Mother's Day", kind: O, rule: nth(2, SUN, 5) },
    { key: "victoria", name: "Victoria Day", kind: P, rule: onOrBefore(5, 24, MON, "the Monday on or before May 24") },
    { key: "fathers-day", name: "Father's Day", kind: O, rule: nth(3, SUN, 6) },
    { key: "canada-day", name: "Canada Day", kind: P, rule: fixed(7, 1) },
    { key: "civic", name: "Civic Holiday (most provinces)", kind: P, rule: nth(1, MON, 8) },
    { key: "labour", name: "Labour Day", kind: P, rule: nth(1, MON, 9) },
    { key: "truth-reconciliation", name: "National Day for Truth and Reconciliation", kind: P, rule: fixed(9, 30) },
    { key: "thanksgiving", name: "Thanksgiving", kind: P, rule: nth(2, MON, 10) },
    { key: "halloween", name: "Halloween", kind: O, rule: fixed(10, 31) },
    { key: "remembrance", name: "Remembrance Day", kind: P, rule: fixed(11, 11) },
    { key: "christmas", name: "Christmas Day", kind: P, rule: fixed(12, 25) },
    { key: "boxing", name: "Boxing Day", kind: P, rule: fixed(12, 26) },
  ],
  au: [
    { key: "new-year", name: "New Year's Day", kind: P, rule: fixed(1, 1) },
    { key: "australia-day", name: "Australia Day", kind: P, rule: fixed(1, 26) },
    { key: "good-friday", name: "Good Friday", kind: P, rule: easter(-2, "two days before Easter Sunday") },
    { key: "easter", name: "Easter Sunday", kind: O, rule: easter(0, "Western Easter (the Gregorian computus)") },
    { key: "easter-monday", name: "Easter Monday", kind: P, rule: easter(1, "the day after Easter Sunday") },
    { key: "anzac", name: "Anzac Day", kind: P, rule: fixed(4, 25) },
    { key: "mothers-day", name: "Mother's Day", kind: O, rule: nth(2, SUN, 5) },
    { key: "kings-birthday", name: "King's Birthday (most states; not WA or QLD)", kind: P, rule: nth(2, MON, 6) },
    { key: "fathers-day", name: "Father's Day", kind: O, rule: nth(1, SUN, 9) },
    { key: "remembrance", name: "Remembrance Day", kind: O, rule: fixed(11, 11) },
    { key: "christmas", name: "Christmas Day", kind: P, rule: fixed(12, 25) },
    { key: "boxing", name: "Boxing Day", kind: P, rule: fixed(12, 26) },
  ],
  intl: [
    { key: "womens-day", name: "International Women's Day", kind: O, rule: fixed(3, 8) },
    { key: "happiness", name: "International Day of Happiness", kind: O, rule: fixed(3, 20) },
    { key: "water", name: "World Water Day", kind: O, rule: fixed(3, 22) },
    { key: "health", name: "World Health Day", kind: O, rule: fixed(4, 7) },
    { key: "earth", name: "Earth Day", kind: O, rule: fixed(4, 22) },
    { key: "book", name: "World Book and Copyright Day", kind: O, rule: fixed(4, 23) },
    { key: "environment", name: "World Environment Day", kind: O, rule: fixed(6, 5) },
    { key: "youth", name: "International Youth Day", kind: O, rule: fixed(8, 12) },
    { key: "humanitarian", name: "World Humanitarian Day", kind: O, rule: fixed(8, 19) },
    { key: "charity", name: "International Day of Charity", kind: O, rule: fixed(9, 5) },
    { key: "literacy", name: "International Literacy Day", kind: O, rule: fixed(9, 8) },
    { key: "older-persons", name: "International Day of Older Persons", kind: O, rule: fixed(10, 1) },
    { key: "teachers", name: "World Teachers' Day", kind: O, rule: fixed(10, 5) },
    { key: "mental-health", name: "World Mental Health Day", kind: O, rule: fixed(10, 10) },
    { key: "girl-child", name: "International Day of the Girl Child", kind: O, rule: fixed(10, 11) },
    { key: "food", name: "World Food Day", kind: O, rule: fixed(10, 16) },
    { key: "kindness", name: "World Kindness Day", kind: O, rule: fixed(11, 13) },
    { key: "womens-entrepreneurship", name: "Women's Entrepreneurship Day", kind: O, rule: fixed(11, 19) },
    { key: "childrens-day", name: "World Children's Day", kind: O, rule: fixed(11, 20) },
    { key: "giving-tuesday", name: "Giving Tuesday", kind: O, rule: afterThanksgiving(5, "the Tuesday after US Thanksgiving") },
    { key: "disabilities", name: "International Day of Persons with Disabilities", kind: O, rule: fixed(12, 3) },
    { key: "volunteer", name: "International Volunteer Day", kind: O, rule: fixed(12, 5) },
    { key: "human-rights", name: "Human Rights Day", kind: O, rule: fixed(12, 10) },
  ],
};

/** A country's library days in one month of one year, in date order. */
export function holidaysIn(country: HolidayCountry, year: number, month: number): Holiday[] {
  const prefix = `${year}-${pad(month)}-`;
  return LIBRARY[country]
    .map((e) => ({ key: `${country}:${e.key}`, name: e.name, kind: e.kind, rule: e.rule.text, date: e.rule.date(year) }))
    .filter((h) => h.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** The workspace's search country as a library country, when there is one. */
export function libraryCountryFor(searchCountry: string): HolidayCountry {
  return searchCountry === "us" || searchCountry === "gb" || searchCountry === "ca" || searchCountry === "au" ? searchCountry : "intl";
}
