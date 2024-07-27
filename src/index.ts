// `@distube/ytdl-core` is a fork of `ytdl-core` that offers more stable features.
// It seems that `ytdl-core` has stopped receiving updates.
import ytdl from "@distube/ytdl-core";
import cp from "child_process";
import ffmpeg from "ffmpeg-static";
import type { Readable } from "stream";

export type InfoSummary = {
  id: string;
  title: string;
  url: string;
  author: {
    name: string;
    url: string;
  };
};

export default class YouTubeDownloader {
  // https://github.com/fent/node-ytdl-core/blob/master/example/ffmpeg.js
  // https://github.com/fent/node-ytdl-core/blob/cc6720f9387088d6253acc71c8a49000544d4d2a/example/ffmpeg.js

  static mp4(source: string) {
    return new YouTubeDownloader(source).stdout;
  }

  static mp3(source: string) {
    return ytdl(source, {
      filter: "audioonly",
      quality: "highestaudio",
    });
  }

  static async info(source: string) {
    try {
      const {
        videoDetails: {
          title,
          videoId: id,
          author: { name, channel_url, external_channel_url },
        },
      } = await ytdl.getInfo(source);
      return {
        id,
        title,
        url: `https://youtu.be/${id}`,
        author: {
          name,
          url: channel_url || external_channel_url || "",
        },
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
  readonly process: cp.ChildProcess;
  readonly audio: Readable;
  readonly video: Readable;

  get stdout(): Readable {
    return this.process.stdout!;
  }

  constructor(source: string) {
    const audio = ytdl(source, {
      quality: "highestaudio",
    }).on("progress", (_, downloaded, total) => {
      this.progress.audio.downloaded = downloaded;
      this.progress.audio.total = total;
    });

    const video = ytdl(source, { quality: "highestvideo" }).on(
      "progress",
      (_, downloaded, total) => {
        this.progress.video.downloaded = downloaded;
        this.progress.video.total = total;
      }
    );

    const process = cp.spawn(
      String(ffmpeg),
      [
        // remove ffmpeg's console spamming
        "-loglevel",
        "8",
        "-hide_banner",
        // redirect / enable progress messages
        "-progress",
        "pipe:3",
        // set inputs
        "-i",
        "pipe:4",
        "-i",
        "pipe:5",
        // choose some fancy codes
        // '-c:v', 'libx265', '-x265-params', 'log-level=0',
        // '-c:a', 'flac',
        // define output container
        "-f",
        "matroska",
        // map audio & video from streams
        "-map",
        "0:a",
        "-map",
        "1:v",
        // keep encoding
        "-c:v",
        "copy",
        // output container (pipe)
        "-",
      ],
      {
        windowsHide: true,
        stdio: ["inherit", "pipe", "inherit", "pipe", "pipe", "pipe"],
      }
    );

    this.source = source;
    this.process = process;
    this.audio = audio;
    this.video = video;

    audio.pipe((process.stdio as any)[4]);
    video.pipe((process.stdio as any)[5]);
  }
}
