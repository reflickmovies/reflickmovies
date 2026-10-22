import type {
  TmdbAggregateCredits,
  TmdbCompany,
  TmdbCountry,
  TmdbCredits,
  TmdbLanguage,
  TmdbMovieDetail,
  TmdbTvDetail,
  TmdbVideo,
  TmdbVideos,
} from './tmdb.types.js';
import type {
  CompanyRef,
  CountryRef,
  CreditRef,
  HighlightedCrewJob,
  LanguageRef,
  TitleDetailsRecord,
} from '../../domain/types.js';

/**
 * TMDB full-detail -> `TitleDetailsRecord`.
 *
 * Pure: no I/O, no logging, no environment. Every branch here exists because TMDB's
 * film and series responses disagree on something - the key a list lives under, the
 * field a value is read from, or which region carries the answer - and each of those
 * disagreements has to be settled exactly once rather than at every call site.
 */

const MAX_CAST = 20;
const MAX_OTHER_CREW = 24;
const MAX_KEYWORDS = 30;

/* ------------------------------------------------------------------- people */

/**
 * Crew jobs are classified in order, and the order is the whole trick.
 *
 * "Director of Photography" matches /director/, so the cinematographer rule has to run
 * first or every film's camera operator is also listed as a director. Each crew *entry*
 * lands in exactly one bucket - a person who both directed and wrote a film appears as
 * two entries and therefore in both lists, which is what the page wants because the two
 * facts are shown in different places.
 */
const CREW_CLASSIFIERS: Array<[HighlightedCrewJob, RegExp]> = [
  ['cinematographers', /director of photography|cinematographer/i],
  ['editors', /film editor|^editor$|co-?editor|film editing/i],
  ['composers', /original music composer|music composer|^composer$|music by/i],
  [
    'directors',
    /^(?:co-?|lead |series |segment |animation |puppet )?director$/i,
  ],
  [
    'writers',
    /\b(?:writer|screenplay|screenwriter|story|teleplay|script|novel|author|characters|dialogue|adaptation)\b/i,
  ],
  ['producers', /\bproducer/i],
];

function classifyCrew(crew: Array<{ id: number; name: string; job?: string; department?: string; profile_path?: string | null }>): {
  buckets: Record<HighlightedCrewJob, CreditRef[]>;
  other: CreditRef[];
} {
  const buckets = {
    directors: [],
    writers: [],
    producers: [],
    composers: [],
    cinematographers: [],
    editors: [],
  } as Record<HighlightedCrewJob, CreditRef[]>;

  const other: CreditRef[] = [];
  const seen = new Set<string>();

  for (const member of crew) {
    const job = member.job?.trim() || null;
    if (!job) continue;

    const key = `${member.id}|${job.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ref: CreditRef = {
      tmdbId: member.id,
      name: member.name,
      character: null,
      job,
      department: member.department ?? null,
      profilePath: member.profile_path ?? null,
      order: null,
    };

    const match = CREW_CLASSIFIERS.find(([, pattern]) => pattern.test(job));
    if (match) {
      buckets[match[0]].push(ref);
    } else {
      other.push(ref);
    }
  }

  for (const list of Object.values(buckets)) list.sort(byName);
  other.sort(byDepartmentThenName);

  return { buckets, other: other.slice(0, MAX_OTHER_CREW) };
}

function byName(a: CreditRef, b: CreditRef): number {
  return a.name.localeCompare(b.name);
}

function byDepartmentThenName(a: CreditRef, b: CreditRef): number {
  const department = (a.department ?? '').localeCompare(b.department ?? '');
  return department !== 0 ? department : byName(a, b);
}

/* -------------------------------------------------------------------- cast */

function mapMovieCast(credits: TmdbCredits | undefined): CreditRef[] {
  const cast = [...(credits?.cast ?? [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  const seen = new Set<number>();
  const mapped: CreditRef[] = [];

  for (const member of cast) {
    if (mapped.length >= MAX_CAST) break;
    if (seen.has(member.id)) continue;
    seen.add(member.id);

    mapped.push({
      tmdbId: member.id,
      name: member.name,
      character: member.character?.trim() || null,
      job: null,
      department: 'Acting',
      profilePath: member.profile_path ?? null,
      order: member.order ?? null,
    });
  }

  return mapped;
}

/**
 * Series cast, from `aggregate_credits`.
 *
 * Ordered by episode count rather than by billing order, because aggregate credits carry
 * no `order` and episode count is the honest signal: it separates a lead who has been in
 * two hundred episodes from a guest who was in one, which is exactly the distinction a
 * reader is making when they scan the row.
 */
function mapTvCast(credits: TmdbAggregateCredits | undefined): CreditRef[] {
  const cast = [...(credits?.cast ?? [])].sort(
    (a, b) => (b.total_episode_count ?? 0) - (a.total_episode_count ?? 0),
  );

  const seen = new Set<number>();
  const mapped: CreditRef[] = [];

  for (const member of cast) {
    if (mapped.length >= MAX_CAST) break;
    if (seen.has(member.id)) continue;
    seen.add(member.id);

    const character = member.roles?.[0]?.character ?? member.character ?? null;

    mapped.push({
      tmdbId: member.id,
      name: member.name,
      character: character?.trim() || null,
      job: null,
      department: 'Acting',
      profilePath: member.profile_path ?? null,
      order: null,
    });
  }

  return mapped;
}

/* ---------------------------------------------------------------- keywords */

/** Films key the list `keywords`, series key the same list `results`. */
function mapKeywords(detail: { keywords?: { keywords?: Array<{ name: string }>; results?: Array<{ name: string }> } }): string[] {
  const source = detail.keywords?.keywords ?? detail.keywords?.results ?? [];
  const unique = new Set<string>();

  for (const keyword of source) {
    const name = keyword.name?.trim();
    if (name) unique.add(name);
    if (unique.size >= MAX_KEYWORDS) break;
  }

  return [...unique].sort((a, b) => a.localeCompare(b));
}

/* -------------------------------------------------------------- production */

function mapCompanies(companies: TmdbCompany[] | undefined): CompanyRef[] {
  return (companies ?? []).map((company) => ({
    tmdbId: company.id,
    name: company.name,
    logoPath: company.logo_path ?? null,
  }));
}

function mapCountries(countries: TmdbCountry[] | undefined): CountryRef[] {
  return (countries ?? [])
    .filter((country) => country.iso_3166_1)
    .map((country) => ({ code: country.iso_3166_1, name: country.name }));
}

function mapLanguages(languages: TmdbLanguage[] | undefined): LanguageRef[] {
  return (languages ?? [])
    .filter((language) => language.iso_639_1)
    .map((language) => ({
      code: language.iso_639_1,
      name: language.name,
      englishName: language.english_name ?? null,
    }));
}

/* --------------------------------------------------------------- ratings */

const HOME_REGION = 'US';

/**
 * The age rating to show.
 *
 * US first because it is the one most readers recognise, then any region that has one at
 * all - a film rated only in its country of origin still gets a badge rather than a blank.
 * An empty-string certification is TMDB's way of saying "this region has no rating", so it
 * is treated as absent rather than shown as a hollow value.
 */
function pickCertification(
  regions: Array<{ iso_3166_1: string; certifications: string[] }> | undefined,
): string | null {
  if (!regions || regions.length === 0) return null;

  const firstRated = (region: { certifications: string[] } | undefined): string | null =>
    region?.certifications?.find((value) => value.trim().length > 0)?.trim() ?? null;

  const home = regions.find((region) => region.iso_3166_1 === HOME_REGION);
  return firstRated(home) ?? regions.map(firstRated).find((value) => value !== null) ?? null;
}

function movieCertification(detail: TmdbMovieDetail): string | null {
  return pickCertification(
    detail.release_dates?.results?.map((region) => ({
      iso_3166_1: region.iso_3166_1,
      certifications: (region.release_dates ?? []).map((entry) => entry.certification ?? ''),
    })),
  );
}

function tvCertification(detail: TmdbTvDetail): string | null {
  return pickCertification(
    detail.content_ratings?.results?.map((region) => ({
      iso_3166_1: region.iso_3166_1,
      certifications: [region.rating ?? ''],
    })),
  );
}

/* ---------------------------------------------------------------- trailer */

/**
 * Scores candidates so the right one wins without a pile of special cases.
 *
 * A trailer outranks a teaser, which outranks a clip; official outranks fan-uploaded at
 * the same type; and among equals the newer upload wins, because the older trailer for a
 * long-delayed film is usually the one that dates the film worst. YouTube only - the rest
 * of the video list is Vimeo and Dailymotion, which cannot be embedded under this CSP.
 */
function scoreVideo(video: TmdbVideo): number {
  let score = 0;
  if (video.type === 'Trailer') score += 100;
  else if (video.type === 'Teaser') score += 60;
  else if (video.type === 'Clip') score += 20;
  else score += 5;

  if (video.official) score += 30;
  return score;
}

function pickTrailer(videos: TmdbVideos | undefined): TmdbVideo | null {
  const candidates = (videos?.results ?? []).filter((video) => video.site === 'YouTube' && video.key);
  if (candidates.length === 0) return null;

  return [...candidates].sort((a, b) => {
    const byScore = scoreVideo(b) - scoreVideo(a);
    if (byScore !== 0) return byScore;
    return (b.published_at ?? '').localeCompare(a.published_at ?? '');
  })[0] as TmdbVideo;
}

/* ------------------------------------------------------------------- main */

function baseDetails() {
  return {
    otherCrew: [] as CreditRef[],
    creators: [] as CreditRef[],
    budget: null as number | null,
    revenue: null as number | null,
  };
}

export function mapMovieDetails(detail: TmdbMovieDetail): TitleDetailsRecord {
  const { buckets, other } = classifyCrew(detail.credits?.crew ?? []);
  const trailer = pickTrailer(detail.videos);

  return {
    ...baseDetails(),
    cast: mapMovieCast(detail.credits),
    directors: buckets.directors,
    writers: buckets.writers,
    producers: buckets.producers,
    composers: buckets.composers,
    cinematographers: buckets.cinematographers,
    editors: buckets.editors,
    otherCrew: other,
    keywords: mapKeywords(detail),
    productionCompanies: mapCompanies(detail.production_companies),
    productionCountries: mapCountries(detail.production_countries),
    spokenLanguages: mapLanguages(detail.spoken_languages),
    certification: movieCertification(detail),
    budget: detail.budget && detail.budget > 0 ? detail.budget : null,
    revenue: detail.revenue && detail.revenue > 0 ? detail.revenue : null,
    trailerKey: trailer?.key ?? null,
    trailerName: trailer?.name?.trim() || null,
    trailerPublishedAt: trailer?.published_at ?? null,
    social: {
      facebook: detail.external_ids?.facebook_id ?? null,
      instagram: detail.external_ids?.instagram_id ?? null,
      twitter: detail.external_ids?.twitter_id ?? null,
      wikidata: detail.external_ids?.wikidata_id ?? null,
    },
    fetchedAt: new Date(),
  };
}

export function mapTvDetails(detail: TmdbTvDetail): TitleDetailsRecord {
  const { buckets, other } = classifyCrew(detail.aggregate_credits?.crew ?? detail.credits?.crew ?? []);
  const trailer = pickTrailer(detail.videos);

  /*
   * `created_by` is the series' creator credit, which TMDB carries inline on the detail
   * rather than inside the credits payload. It is the single most-wanted crew fact on a
   * series page and has no crew-job equivalent, so it is read from its own field.
   */
  const creators: CreditRef[] = (detail.created_by ?? []).map((person) => ({
    tmdbId: person.id,
    name: person.name,
    character: null,
    job: 'Creator',
    department: 'Writing',
    profilePath: person.profile_path ?? null,
    order: null,
  }));

  return {
    ...baseDetails(),
    cast: mapTvCast(detail.aggregate_credits ?? detail.credits),
    directors: buckets.directors,
    writers: buckets.writers,
    creators,
    producers: buckets.producers,
    composers: buckets.composers,
    cinematographers: buckets.cinematographers,
    editors: buckets.editors,
    otherCrew: other,
    keywords: mapKeywords(detail),
    productionCompanies: mapCompanies(detail.production_companies),
    productionCountries: mapCountries(detail.production_countries),
    spokenLanguages: mapLanguages(detail.spoken_languages ?? (detail.languages ?? []).map((code) => ({ iso_639_1: code, name: code }))),
    certification: tvCertification(detail),
    // A series has no production budget or box office on TMDB; null is the honest answer.
    budget: null,
    revenue: null,
    trailerKey: trailer?.key ?? null,
    trailerName: trailer?.name?.trim() || null,
    trailerPublishedAt: trailer?.published_at ?? null,
    social: {
      facebook: detail.external_ids?.facebook_id ?? null,
      instagram: detail.external_ids?.instagram_id ?? null,
      twitter: detail.external_ids?.twitter_id ?? null,
      wikidata: detail.external_ids?.wikidata_id ?? null,
    },
    fetchedAt: new Date(),
  };
}
