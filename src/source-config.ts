export type ZennFeedType = "trend" | "user" | "topic";

export type QuerySourceConfig = {
  query: string;
  maxResults: number;
};

export type WikipediaSourceConfig = {
  language: string;
  maxResults: number;
};

export type ZennSourceConfig = {
  feedType: ZennFeedType;
  value: string;
  maxResults: number;
};

export type YouTubeSourceConfig = {
  channelId: string;
  maxResults: number;
};

export const DEFAULT_ARXIV_QUERY = "cat:cs.AI";
export const DEFAULT_ARXIV_MAX_RESULTS = 3;
export const DEFAULT_WIKIPEDIA_LANGUAGE = "ja";
export const DEFAULT_WIKIPEDIA_MAX_RESULTS = 3;
export const DEFAULT_QIITA_QUERY = "";
export const DEFAULT_QIITA_MAX_RESULTS = 3;
export const DEFAULT_ZENN_FEED_TYPE: ZennFeedType = "trend";
export const DEFAULT_ZENN_MAX_RESULTS = 3;
export const DEFAULT_YOUTUBE_CHANNEL_ID = "";
export const DEFAULT_YOUTUBE_MAX_RESULTS = 1;

export function readQuerySourceConfig(
  sourceConfigJson: string,
  defaultQuery: string,
  defaultMaxResults: number,
): QuerySourceConfig {
  try {
    const parsed = JSON.parse(sourceConfigJson) as Partial<QuerySourceConfig>;
    return {
      query: typeof parsed.query === "string" ? parsed.query : defaultQuery,
      maxResults:
        typeof parsed.maxResults === "number" && Number.isFinite(parsed.maxResults)
          ? parsed.maxResults
          : defaultMaxResults,
    };
  } catch {
    return {
      query: defaultQuery,
      maxResults: defaultMaxResults,
    };
  }
}

export function readWikipediaConfig(sourceConfigJson: string): WikipediaSourceConfig {
  try {
    const parsed = JSON.parse(sourceConfigJson) as Partial<WikipediaSourceConfig>;
    return {
      language:
        typeof parsed.language === "string" ? parsed.language : DEFAULT_WIKIPEDIA_LANGUAGE,
      maxResults:
        typeof parsed.maxResults === "number" && Number.isFinite(parsed.maxResults)
          ? parsed.maxResults
          : DEFAULT_WIKIPEDIA_MAX_RESULTS,
    };
  } catch {
    return {
      language: DEFAULT_WIKIPEDIA_LANGUAGE,
      maxResults: DEFAULT_WIKIPEDIA_MAX_RESULTS,
    };
  }
}

export function readZennConfig(sourceConfigJson: string): ZennSourceConfig {
  try {
    const parsed = JSON.parse(sourceConfigJson) as Partial<ZennSourceConfig>;
    const feedType =
      parsed.feedType === "user" || parsed.feedType === "topic"
        ? parsed.feedType
        : DEFAULT_ZENN_FEED_TYPE;
    return {
      feedType,
      value: typeof parsed.value === "string" ? parsed.value : "",
      maxResults:
        typeof parsed.maxResults === "number" && Number.isFinite(parsed.maxResults)
          ? parsed.maxResults
          : DEFAULT_ZENN_MAX_RESULTS,
    };
  } catch {
    return {
      feedType: DEFAULT_ZENN_FEED_TYPE,
      value: "",
      maxResults: DEFAULT_ZENN_MAX_RESULTS,
    };
  }
}

export function readYouTubeConfig(sourceConfigJson: string): YouTubeSourceConfig {
  try {
    const parsed = JSON.parse(sourceConfigJson) as Partial<YouTubeSourceConfig>;
    return {
      channelId:
        typeof parsed.channelId === "string" ? parsed.channelId : DEFAULT_YOUTUBE_CHANNEL_ID,
      maxResults:
        typeof parsed.maxResults === "number" && Number.isFinite(parsed.maxResults)
          ? parsed.maxResults
          : DEFAULT_YOUTUBE_MAX_RESULTS,
    };
  } catch {
    return {
      channelId: DEFAULT_YOUTUBE_CHANNEL_ID,
      maxResults: DEFAULT_YOUTUBE_MAX_RESULTS,
    };
  }
}

export function normalizeYouTubeChannelInput(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/(?:^|\/channel\/)(UC[A-Za-z0-9_-]{18,30})(?:[\/?#]|$)/);
  return match?.[1] ?? null;
}
