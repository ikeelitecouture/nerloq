export interface ExternalVideoEmbed {
  readonly provider: "youtube" | "vimeo";
  readonly sourceUrl: string;
  readonly embedUrl: string;
}

/** Only provider-owned embed hosts are returned; arbitrary URLs stay ordinary links. */
export function resolveExternalVideoEmbed(input: string): ExternalVideoEmbed | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const id = host === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.pathname === "/watch"
        ? url.searchParams.get("v")
        : url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return { provider: "youtube", sourceUrl: url.toString(), embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.match(/^\/(?:video\/)?(\d+)\/?$/)?.[1];
    if (!id) return null;
    return { provider: "vimeo", sourceUrl: url.toString(), embedUrl: `https://player.vimeo.com/video/${id}` };
  }
  return null;
}
