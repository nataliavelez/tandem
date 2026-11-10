{/*
Countries/regions for survey drop-downs: ISO 3166-1 alpha-2 codes (plus XK,
Kosovo). The code is what gets logged, so the data doesn't depend on how a
browser spells a name; names are shown in English from the browser
(Intl.DisplayNames), sorted by name.

Created by: Elizabeth Mieczkowski, Updated: 11/2026
*/}

const CODES = `
  AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS
  BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE
  EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM
  HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC
  LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA
  NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW
  SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO
  TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW
`.trim().split(/\s+/);

let cached: { value: string; label: string }[] | null = null;

/** Every country/region as { value: ISO code, label: English name }, sorted by name. */
export function countryOptions() {
  if (cached) return cached;
  let name = (code: string) => code;
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    name = (code) => dn.of(code) ?? code;
  } catch { /* very old browser: show codes */ }
  cached = CODES.map((value) => ({ value, label: name(value) }))
    .sort((a, b) => a.label.localeCompare(b.label, "en"));
  return cached;
}
