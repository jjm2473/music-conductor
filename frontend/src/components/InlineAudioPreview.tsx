import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";

const ignoreMediaPreviewError = () => {
  // Some formats may not be decodable by current browser; ignore preview errors by requirement.
};

const tryPlayMedia = (audio: HTMLAudioElement, onError: () => void) => {
  try {
    const result = audio.play();
    if (result && typeof (result as Promise<void>).catch === "function") {
      void (result as Promise<void>).catch(() => {
        onError();
      });
    }
  } catch {
    onError();
  }
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
  autoPlayToken?: number;
  className?: string;
};

export default function InlineAudioPreview({
  playerId,
  sourceUrl,
  autoPlayToken,
  className,
}: InlineAudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeFrameRef = useRef<number | null>(null);
  const targetVolumeRef = useRef(1);

  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [activeSourceUrl, setActiveSourceUrl] = useState(sourceUrl);
  const [playing, setPlaying] = useState(false);
  const [loadingPlay, setLoadingPlay] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);

  const clearFadeFrame = () => {
    if (fadeFrameRef.current != null) {
      window.cancelAnimationFrame(fadeFrameRef.current);
      fadeFrameRef.current = null;
    }
  };

  const fadeVolumeTo = (audio: HTMLAudioElement, targetVolume: number, durationMs: number, onDone?: () => void) => {
    clearFadeFrame();

    const clampedTarget = Math.max(0, Math.min(1, targetVolume));
    const clampedDuration = Math.max(1, durationMs);
    const startVolume = Math.max(0, Math.min(1, audio.volume));
    const startAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startAt) / clampedDuration);
      const nextVolume = startVolume + (clampedTarget - startVolume) * progress;
      audio.volume = Math.max(0, Math.min(1, nextVolume));

      if (progress < 1) {
        fadeFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      fadeFrameRef.current = null;
      onDone?.();
    };

    fadeFrameRef.current = window.requestAnimationFrame(tick);
  };

  const fadeInAfterPlay = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.volume = 0;
    fadeVolumeTo(audio, targetVolumeRef.current, 160);
  };

  const fadeOutAndPause = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    fadeVolumeTo(audio, 0, 130, () => {
      audio.pause();
      audio.volume = targetVolumeRef.current;
    });
  };

  useEffect(() => {
    if (sourceUrl === activeSourceUrl) {
      return;
    }

    const audio = audioRef.current;
    const switchSource = () => {
      clearFadeFrame();
      setPlaying(false);
      setLoadingPlay(false);
      setPositionSec(0);
      setDurationSec(0);

      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = targetVolumeRef.current;
      }

      setSourceLoaded(false);
      setActiveSourceUrl(sourceUrl);
    };

    if (!audio || audio.paused || !sourceLoaded) {
      switchSource();
      return;
    }

    fadeVolumeTo(audio, 0, 130, () => {
      switchSource();
    });
  }, [sourceUrl, activeSourceUrl, sourceLoaded]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const onPlay = () => {
      setPlaying(true);
      setLoadingPlay(false);
      fadeInAfterPlay();
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
      clearFadeFrame();
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

    tryPlayMedia(audio, () => {
      setLoadingPlay(false);
      ignoreMediaPreviewError();
    });
  }, [sourceLoaded, loadingPlay]);

  useEffect(() => {
    if (autoPlayToken == null) {
      return;
    }
    if (activeSourceUrl !== sourceUrl) {
      return;
    }
    setLoadingPlay(true);
    if (!sourceLoaded) {
      setSourceLoaded(true);
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    tryPlayMedia(audio, () => {
      setLoadingPlay(false);
      ignoreMediaPreviewError();
    });
  }, [autoPlayToken, sourceLoaded, activeSourceUrl, sourceUrl]);

  useEffect(() => {
    return () => {
      clearFadeFrame();
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (playing) {
      fadeOutAndPause();
      return;
    }

    setLoadingPlay(true);

    if (!sourceLoaded) {
      setSourceLoaded(true);
      return;
    }

    tryPlayMedia(audio, () => {
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
  const toggleAriaLabel = playing ? "暂停播放" : loadingPlay ? "加载中" : "播放";
  const toggleIconClass = playing ? "icon-suspend" : loadingPlay ? "icon-loading is-spinning" : "icon-play";

  return (
    <div className={`inline-audio-player ${className ?? ""}`.trim()} data-player-id={playerId}>
      <button
        type="button"
        className="inline-audio-toggle"
        onClick={togglePlay}
        aria-label={toggleAriaLabel}
        title={toggleAriaLabel}
      >
        <span className={`iconfont ${toggleIconClass}`} aria-hidden="true" />
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
        src={sourceLoaded ? activeSourceUrl : undefined}
      />
    </div>
  );
}
