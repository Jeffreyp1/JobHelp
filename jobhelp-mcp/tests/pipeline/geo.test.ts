import { describe, expect, it } from 'vitest';
import { detectCountryFromLocation } from '../../core/pipeline/classify.js';
import { looksLikeConcretePlace } from '../../core/pipeline/geo.js';

// Every non-US case below was observed leaking through the country filter in the
// 2026-07-19 live-pool audit (top-1000 ranked jobs, 355 undetected locations).
const CASES: ReadonlyArray<readonly [string, string | undefined]> = [
  ['São Paulo', 'Brazil'],
  ['Belo Horizonte, MG', 'Brazil'],
  ['Tel Aviv', 'Israel'],
  ['Tel Aviv-Yafo, Tel Aviv District, Israel', 'Israel'],
  ['Herzliya', 'Israel'],
  ['Lisbon, Portugal', 'Portugal'],
  ['Porto', 'Portugal'],
  ['Poland', 'Poland'],
  ['Warszawa, Masovian Voivodeship, Poland', 'Poland'],
  ['Kraków, Poland', 'Poland'],
  ['Prague, Czech Republic', 'Czech Republic'],
  ['Czechia', 'Czech Republic'],
  ['Brno', 'Czech Republic'],
  ['Jakarta, Indonesia', 'Indonesia'],
  ['Kuala Lumpur', 'Malaysia'],
  ['Ho Chi Minh City, Ho Chi Minh City, Vietnam', 'Vietnam'],
  ['Hanoi', 'Vietnam'],
  ['Remote in the Philippines', 'Philippines'],
  ['Manila', 'Philippines'],
  ['Budapest, Hungary', 'Hungary'],
  ['Timișoara, Timiș, Romania', 'Romania'],
  ['Bucharest', 'Romania'],
  ['Belgrade, Serbia', 'Serbia'],
  ['Ukraine', 'Ukraine'],
  ['Kyiv', 'Ukraine'],
  ['Vilnius', 'Lithuania'],
  ['Riga', 'Latvia'],
  ['Tallinn', 'Estonia'],
  ['Sofia', 'Bulgaria'],
  ['Taipei, Taiwan', 'Taiwan'],
  ['Istanbul', 'Turkey'],
  ['Cape Town', 'South Africa'],
  ['Hybrid - Helsinki, Uusimaa', 'Finland'],
  ['Stockholm HQ', 'Sweden'],
  ['Zürich', 'Switzerland'],
  ['Geneva', 'Switzerland'],
  ['Vienna', 'Austria'],
  ['Brussels', 'Belgium'],
  ['Copenhagen', 'Denmark'],
  ['Oslo', 'Norway'],
  ['Moldova', 'Moldova'],
  ['Lima', 'Peru'],
  ['Bogotá', 'Colombia'],
  ['Santiago', 'Chile'],
  ['Cairo', 'Egypt'],
  ['Riyadh', 'Saudi Arabia'],
  ['Dubai', 'UAE'],
  ['Bangkok', 'Thailand'],
  ['Athens', 'Greece'],
  ['Lahore', 'Pakistan'],
  ['Almaty', 'Kazakhstan'],
  ['Tbilisi', 'Georgia'],
  ['Tbilisi, Georgia', 'Georgia'],
  ['Porto Alegre', 'Brazil'],
  ['Porto Alegre, Brazil', 'Brazil'],
  ['Costa Rica', 'Costa Rica'],
  ['Montevideo', 'Uruguay'],
  ['Lagos', 'Nigeria'],
  ['Nairobi', 'Kenya'],
  ['Dhaka', 'Bangladesh'],
  ['Colombo, Sri Lanka', 'Sri Lanka'],
  ['Karnataka', 'India'],
  ['Belfast', 'UK'],
  ['Hilversum', 'Netherlands'],
];

describe('detectCountryFromLocation: audit-observed leaks', () => {
  it.each(CASES)('%s -> %s', (location, expected) => {
    expect(detectCountryFromLocation(location)).toBe(expected);
  });
});

describe('detectCountryFromLocation: US coverage and precedence', () => {
  it('recognizes every spelled-out US state name', () => {
    expect(detectCountryFromLocation('Guilford, Connecticut')).toBe('US');
    expect(detectCountryFromLocation('Bozeman, Montana')).toBe('US');
    expect(detectCountryFromLocation('Springfield, Missouri')).toBe('US');
    expect(detectCountryFromLocation('Remote - Ohio')).toBe('US');
    expect(detectCountryFromLocation('Anchorage, Alaska')).toBe('US');
    expect(detectCountryFromLocation('Cheyenne, Wyoming')).toBe('US');
  });

  it('recognizes bare US tech-hub cities', () => {
    expect(detectCountryFromLocation('New York')).toBe('US');
    expect(detectCountryFromLocation('Palo Alto')).toBe('US');
    expect(detectCountryFromLocation('Sunnyvale')).toBe('US');
    expect(detectCountryFromLocation('Brooklyn')).toBe('US');
  });

  it('recognizes US shorthand seen in live postings', () => {
    expect(detectCountryFromLocation('Bay Area')).toBe('US');
    expect(detectCountryFromLocation('San Carlos  - Hybrid')).toBe('US');
    expect(detectCountryFromLocation('San Jose')).toBe('US');
    expect(detectCountryFromLocation('RWC HQ')).toBe('US');
    expect(detectCountryFromLocation('NY, SF or Remote')).toBe('US');
    expect(detectCountryFromLocation('sf')).toBe('US');
    expect(detectCountryFromLocation('Remote, U.S')).toBe('US');
    expect(detectCountryFromLocation('Washington, D.C.')).toBe('US');
    expect(detectCountryFromLocation('NAMER')).toBe('US');
    expect(detectCountryFromLocation('Alexandria HQ (remote)')).toBe('US');
    expect(detectCountryFromLocation('Stamford')).toBe('US');
    expect(detectCountryFromLocation('West Coast')).toBe('US');
  });

  it('does not let the bare san jose rule claim Costa Rica', () => {
    expect(detectCountryFromLocation('San Jose, CR')).toBe('Costa Rica');
    expect(detectCountryFromLocation('San Jose, Costa Rica')).toBe('Costa Rica');
    expect(detectCountryFromLocation('San Jose, CA')).toBe('US');
    expect(detectCountryFromLocation('San Jose')).toBe('US');
  });

  it('recognizes spelled-out UK and Canadian markers', () => {
    expect(detectCountryFromLocation('Guildford, UK')).toBe('UK');
    expect(detectCountryFromLocation('Remote, Ontario')).toBe('Canada');
    expect(detectCountryFromLocation('Vancouver, British Columbia')).toBe('Canada');
  });

  it('lets the US state-code rule win over new country-city rules', () => {
    expect(detectCountryFromLocation('Vienna, VA')).toBe('US');
    expect(detectCountryFromLocation('Athens, GA')).toBe('US');
    expect(detectCountryFromLocation('Lima, OH')).toBe('US');
  });

  it('resolves "<foreign city>, <matching ISO>" to the foreign country, not the colliding US state code', () => {
    expect(detectCountryFromLocation('Mumbai, IN')).toBe('India');
    expect(detectCountryFromLocation('Toronto, CA')).toBe('Canada');
    expect(detectCountryFromLocation('Berlin, DE')).toBe('Germany');
    expect(detectCountryFromLocation('Bogota, CO')).toBe('Colombia');
  });

  it('keeps US when the trailing state code is NOT the city\'s country ISO', () => {
    expect(detectCountryFromLocation('Dublin, CA')).toBe('US');
    expect(detectCountryFromLocation('Vienna, VA')).toBe('US');
    expect(detectCountryFromLocation('Athens, GA')).toBe('US');
    expect(detectCountryFromLocation('Lima, OH')).toBe('US');
    expect(detectCountryFromLocation('Indianapolis, IN')).toBe('US');
    expect(detectCountryFromLocation('San Francisco, CA')).toBe('US');
  });

  it('does not read lowercase prose after a comma as a US state code', () => {
    expect(detectCountryFromLocation('London, or Remote')).toBe('UK');
    expect(detectCountryFromLocation('Remote, in office')).toBeUndefined();
  });

  it('still recognizes uppercase US state codes', () => {
    expect(detectCountryFromLocation('Austin, TX')).toBe('US');
    expect(detectCountryFromLocation('Boise, ID')).toBe('US');
    expect(detectCountryFromLocation('San Jose, CA')).toBe('US');
  });

  it('still returns undefined for genuinely unknowable locations', () => {
    expect(detectCountryFromLocation('Remote')).toBeUndefined();
    expect(detectCountryFromLocation('Home based - Worldwide')).toBeUndefined();
    expect(detectCountryFromLocation('In-Office')).toBeUndefined();
    expect(detectCountryFromLocation('Hybrid')).toBeUndefined();
    expect(detectCountryFromLocation('')).toBeUndefined();
  });
});

describe('looksLikeConcretePlace', () => {
  it('is true for named places the detector cannot classify', () => {
    expect(looksLikeConcretePlace('Milton Keynes Office')).toBe(true);
    expect(looksLikeConcretePlace('Vilnius')).toBe(true);
    expect(looksLikeConcretePlace('RWC HQ')).toBe(true);
  });

  it('is false for remote/arrangement-only strings', () => {
    expect(looksLikeConcretePlace('Remote')).toBe(false);
    expect(looksLikeConcretePlace('Home based - Worldwide')).toBe(false);
    expect(looksLikeConcretePlace('In-Office')).toBe(false);
    expect(looksLikeConcretePlace('Hybrid')).toBe(false);
    expect(looksLikeConcretePlace('Full-time')).toBe(false);
    expect(looksLikeConcretePlace('Field')).toBe(false);
    expect(looksLikeConcretePlace('100% Remote (Global)')).toBe(false);
    expect(looksLikeConcretePlace('Remote, Anywhere')).toBe(false);
    expect(looksLikeConcretePlace('World Wide - Remote')).toBe(false);
    expect(looksLikeConcretePlace('')).toBe(false);
  });
});
