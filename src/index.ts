// `@distube/ytdl-core` is a fork of `ytdl-core` that offers more stable features.
// It seems that `ytdl-core` has stopped receiving updates.
import ytdlCore from "@distube/ytdl-core";
import fs from "fs";
import cp from "child_process";
import ffmpeg from "ffmpeg-static";
import type { Readable, Writable } from "stream";

export type YTDLInfo<Full extends boolean = boolean> = {
  id: string;
  title: string;
  url: string;
  author: {
    name: string;
    url: string;
  };
} & (Full extends true
  ? { raw: ytdlCore.videoInfo }
  : Full extends false
  ? {}
  : { raw?: ytdlCore.videoInfo });

export type FormatQuality =
  | "lowest"
  | "highest"
  | "highestaudio"
  | "lowestaudio"
  | "highestvideo"
  | "lowestvideo"
  | string
  | number
  | string[]
  | number[];

export type FFMpegPreset =
  | "ultrafast"
  | "superfast"
  | "veryfast"
  | "faster"
  | "fast"
  | "medium"
  | "slow"
  | "slower"
  | "veryslow"
  | "placebo";

export type YTDLOptions = {
  audioQuality?: FormatQuality;
  videoQuality?: FormatQuality;
  audioCodec?: string;
  videoCodec?: string;
  format?: string;
  preset?: FFMpegPreset;
  videoOnly?: boolean;
  audioOnly?: boolean;
  output?: string | Writable;
};

export type MP3Options = {
  quality?: FormatQuality;
  codec?: string;
  output?: string | Writable;
};

export default class YTDL {
  // https://github.com/fent/node-ytdl-core/blob/master/example/ffmpeg.js
  // https://github.com/fent/node-ytdl-core/blob/cc6720f9387088d6253acc71c8a49000544d4d2a/example/ffmpeg.js

  static get(source: string, output: string | Writable): YTDL;
  static get(source: string, options?: YTDLOptions): YTDL;
  static get(source: string, options?: string | Writable | YTDLOptions) {
    return new YTDL(
      source,
      typeof options === "string" || (options && "on" in options)
        ? { output: options }
        : options
    );
  }

  static mp4(source: string, options?: YTDLOptions) {
    return new YTDL(source, { format: "mp4", ...options });
  }

  static mp3(source: string, options: MP3Options = {}) {
    const { quality: audioQuality, codec: audioCodec, ...o } = options;
    return new YTDL(source, {
      audioOnly: true,
      audioQuality,
      audioCodec,
      ...o,
    });
  }

  static async info<Full extends boolean>(
    source: string
  ): Promise<YTDLInfo<false> | null>;
  static async info<Full extends boolean>(
    source: string,
    full: Full
  ): Promise<YTDLInfo<Full> | null>;
  static async info(source: string, full?: boolean) {
    try {
      const raw = await ytdlCore.getInfo(source);
      const {
        videoDetails: {
          title,
          videoId: id,
          author: { name, channel_url, external_channel_url },
        },
      } = raw;
      return {
        id,
        title,
        url: `https://youtu.be/${id}`,
        author: {
          name,
          url: channel_url || external_channel_url || "",
        },
        raw: full ? raw : undefined,
      };
    } catch {}
    return null;
  }

  readonly progress = {
    audio: { downloaded: 0, total: Infinity },
    video: { downloaded: 0, total: Infinity },
    get downloaded() {
      return this.audio.downloaded + this.video.downloaded;
    },
    get total() {
      return this.audio.total + this.video.total;
    },
    get value() {
      return this.downloaded / this.total;
    },
  };

  readonly source: string;
  readonly process?: cp.ChildProcess;
  readonly audio?: Readable;
  readonly video?: Readable;
  private readonly _readable?: Readable;

  get stream(): Readable {
    return this.process?.stdout ?? this._readable!;
  }

  onprogress?: (progress: number) => any;

  private constructor(
    source: string,
    options: {
      audioQuality?: FormatQuality;
      videoQuality?: FormatQuality;
      audioCodec?: string | null;
      videoCodec?: string | null;
      format?: string;
      preset?: FFMpegPreset;
      videoOnly?: boolean;
      audioOnly?: boolean;
      output?: string | Writable;
    } = {}
  ) {
    this.source = source;

    const {
      audioQuality = "highestaudio",
      videoQuality = "highestvideo",
      audioCodec,
      videoCodec = "copy",
      format = "matroska",
      preset = "medium",
      videoOnly = false,
      audioOnly = false,
      output,
    } = options;

    const audio = videoOnly
      ? undefined
      : ytdlCore(source, {
          filter: audioOnly ? "audioonly" : undefined,
          quality: audioQuality,
        }).on("progress", (_, downloaded, total) => {
          this.progress.audio.downloaded = downloaded;
          this.progress.audio.total = total;
        });

    const video = audioOnly
      ? undefined
      : ytdlCore(source, {
          filter: videoOnly ? "videoonly" : undefined,
          quality: videoQuality,
        }).on("progress", (_, downloaded, total) => {
          this.progress.video.downloaded = downloaded;
          this.progress.video.total = total;
        });

    if (audioOnly) this.progress.video.total = 0;
    if (videoOnly) this.progress.audio.total = 0;

    if (!(audio || video))
      throw new Error("`audioOnly` and `videoOnly` cannot both be true");

    const isStreamOutput = typeof output !== "string";

    if (!audio || !video) {
      const readable = (audio || video)!;
      readable.on("data", () => {
        this.onprogress?.(this.progress.value);
      });
      if (isStreamOutput) {
        if (output) readable.pipe(output);
      } else {
        readable.pipe(fs.createWriteStream(output));
      }
      this._readable = readable;
      return this;
    }

    const process = cp.spawn(
      String(ffmpeg),
      [
        // ffmpeg's console spamming
        ["-loglevel", "quiet", "-hide_banner"],
        // redirect / enable progress messages
        ["-progress", "pipe:3"],
        // set inputs
        ["-i", "pipe:4", "-i", "pipe:5"],
        // video codec, default=copy, others: copy (keep encoding), libx264
        videoCodec ? ["-c:v", videoCodec] : [],
        // audio codec, default=undefined, others: copy (keep encoding), aac
        audioCodec ? ["-c:a", audioCodec] : [],
        // encoding speed
        ["-preset", preset],
        // set format, default=matroska, more: mp4,
        ["-f", format],
        // map audio & video from streams
        ["-map", "0:a", "-map", "1:v"],
        // output container, "-" is stream
        isStreamOutput ? "-" : output,
      ].flat(),
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe", "pipe", "pipe", "pipe"],
      }
    );

    this.process = process;
    this.audio = audio;
    this.video = video;

    audio.pipe((process.stdio as any)[4]);
    video.pipe((process.stdio as any)[5]);

    (process.stdio as Readable[])[3].on("data", () => {
      this.onprogress?.(this.progress.value);
    });
  }
}
