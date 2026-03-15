import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";

const ignoreMediaPreviewError = () => {
  // Some formats may not be decodable by current browser; ignore preview errors by requirement.
};

const formatPlayerTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
};

type InlineAudioPreviewProps = {
  playerId: string;
  sourceUrl: string;
};

export default function InlineAudioPreview({ playerId, sourceUrl }: InlineAudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loadingPlay, setLoadingPlay] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const onPlay = () => {
      setPlaying(true);
      setLoadingPlay(false);
    };
    const onPause = () => {
      setPlaying(false);
    };
    const onTimeUpdate = () => {
      setPositionSec(audio.currentTime || 0);
    };
    const onLoadedMetadata = () => {
      const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      setDurationSec(nextDuration);
    };
    const onEnded = () => {
      setPlaying(false);
    };
    const onError = () => {
      setLoadingPlay(false);
      setPlaying(false);
      ignoreMediaPreviewError();
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    if (!sourceLoaded || !loadingPlay) {
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    void audio.play().catch(() => {
      setLoadingPlay(false);
      ignoreMediaPreviewError();
    });
  }, [sourceLoaded, loadingPlay]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (playing) {
      audio.pause();
      return;
    }

    setLoadingPlay(true);

    if (!sourceLoaded) {
      setSourceLoaded(true);
      return;
    }

    void audio.play().catch(() => {
      setLoadingPlay(false);
      ignoreMediaPreviewError();
    });
  };

  const onSeek = (event: ChangeEvent<HTMLInputElement>) => {
    const nextPosition = Number(event.target.value);
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextPosition)) {
      return;
    }

    audio.currentTime = nextPosition;
    setPositionSec(nextPosition);
  };

  const normalizedDuration = durationSec > 0 ? durationSec : 0;
  const normalizedPosition = Math.max(0, Math.min(positionSec, normalizedDuration));

  return (
    <div className="inline-audio-player" data-player-id={playerId}>
      <button type="button" className="inline-audio-toggle" onClick={togglePlay}>
        {playing ? "暂停" : loadingPlay ? "加载中" : "播放"}
      </button>

      <input
        className="inline-audio-seek"
        type="range"
        min={0}
        max={normalizedDuration}
        step={1}
        value={normalizedPosition}
        onChange={onSeek}
        disabled={normalizedDuration <= 0}
        aria-label="播放位置"
      />

      <span className="inline-audio-time">{formatPlayerTime(normalizedPosition)} / {formatPlayerTime(normalizedDuration)}</span>

      <audio
        ref={audioRef}
        preload="none"
        src={sourceLoaded ? sourceUrl : undefined}
      />
    </div>
  );
}
