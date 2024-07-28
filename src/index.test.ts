import YTDL from ".";

throw 1;

const dl = YTDL.mp3("https://music.youtube.com/watch?v=NmB9Rq1yVmo", {
  output: "a.mp3",
});

dl.onprogress = (v) =>
  console.log(
    `progress: ${Math.floor(v * 100)
      .toString()
      .padStart(3, " ")}%`
  );
