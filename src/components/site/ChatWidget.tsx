import { useState, useEffect, useRef } from "react";

// ============================================================
// CONFIG — Backend API URL
// ============================================================
const API_BASE: string =
  (import.meta as any)?.env?.VITE_AI_BACKEND_URL || "https://chatbot-qpnn.onrender.com";

type CallPhase = "connecting" | "speaking" | "listening" | "thinking" | "ended";
type PanelView = "closed" | "live";

export default function ChatWidget() {
  const [view, setView] = useState<PanelView>("closed");
  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [micVolume, setMicVolume] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const micVolumeRef = useRef<number>(0);
  const phaseRef = useRef<CallPhase>("connecting");
  const isMutedRef = useRef<boolean>(false);

  const sessionIdRef = useRef<string>("");
  const recognitionRef = useRef<any>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const continuousRef = useRef<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Persistent MediaStream & Web Audio VAD
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const vadIntervalRef = useRef<any>(null);
  const silenceTimerRef = useRef<any>(null);
  const speechSilenceTimerRef = useRef<any>(null);
  const latestSpeechTextRef = useRef<string>("");
  const speechDetectedRef = useRef<boolean>(false);
  const isProcessingTurnRef = useRef<boolean>(false);
  const isRecordingRef = useRef<boolean>(false);
  const speechWatchdogRef = useRef<any>(null);
  const ttsAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    micVolumeRef.current = micVolume;
  }, [micVolume]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Session id: persisted per browser tab session
  useEffect(() => {
    let id = sessionStorage.getItem("dg_session_id");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("dg_session_id", id);
    }
    sessionIdRef.current = id;
  }, []);

  // Preload speech synthesis voices
  useEffect(() => {
    const load = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);

  // ============================================================
  // EXACT SMARTDUKAAN SINE WAVE CANVAS VISUALIZER
  // ============================================================
  useEffect(() => {
    if (view === "closed") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };

    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    const waves = [
      {
        freq: 0.014,
        amp: 24,
        phase: 0,
        speed: 0.075,
        color: {
          connecting: "rgba(251, 191, 36, 0.18)",
          listening: "rgba(52, 211, 153, 0.22)",
          speaking: "rgba(244, 63, 94, 0.22)",
          thinking: "rgba(192, 132, 252, 0.22)",
          idle: "rgba(168, 85, 247, 0.18)",
        },
        stroke: {
          connecting: "#fbbf24",
          listening: "#34d399",
          speaking: "#f43f5e",
          thinking: "#c084fc",
          idle: "#a855f7",
        },
        lineWidth: 2,
      },
      {
        freq: 0.022,
        amp: 18,
        phase: 1.5,
        speed: -0.06,
        color: {
          connecting: "rgba(245, 158, 11, 0.15)",
          listening: "rgba(45, 212, 191, 0.18)",
          speaking: "rgba(236, 72, 153, 0.18)",
          thinking: "rgba(139, 92, 246, 0.18)",
          idle: "rgba(59, 130, 246, 0.15)",
        },
        stroke: {
          connecting: "#f59e0b",
          listening: "#2dd4bf",
          speaking: "#ec4899",
          thinking: "#8b5cf6",
          idle: "#3b82f6",
        },
        lineWidth: 1.8,
      },
      {
        freq: 0.009,
        amp: 28,
        phase: 3.0,
        speed: 0.045,
        color: {
          connecting: "rgba(217, 119, 6, 0.18)",
          listening: "rgba(16, 185, 129, 0.20)",
          speaking: "rgba(225, 29, 72, 0.22)",
          thinking: "rgba(168, 85, 247, 0.20)",
          idle: "rgba(236, 72, 153, 0.18)",
        },
        stroke: {
          connecting: "#d97706",
          listening: "#10b981",
          speaking: "#e11d48",
          thinking: "#a855f7",
          idle: "#ec4899",
        },
        lineWidth: 2.2,
      },
      {
        freq: 0.028,
        amp: 12,
        phase: 4.5,
        speed: -0.085,
        color: {
          connecting: "rgba(255, 255, 255, 0.22)",
          listening: "rgba(255, 255, 255, 0.25)",
          speaking: "rgba(255, 255, 255, 0.25)",
          thinking: "rgba(255, 255, 255, 0.25)",
          idle: "rgba(255, 255, 255, 0.20)",
        },
        stroke: {
          connecting: "#ffffff",
          listening: "#ffffff",
          speaking: "#ffffff",
          thinking: "#ffffff",
          idle: "#ffffff",
        },
        lineWidth: 1.5,
      },
    ];

    const glowColors: Record<string, string> = {
      connecting: "rgba(251, 191, 36, 0.20)",
      listening: "rgba(52, 211, 153, 0.24)",
      speaking: "rgba(244, 63, 94, 0.25)",
      thinking: "rgba(192, 132, 252, 0.24)",
      idle: "rgba(168, 85, 247, 0.20)",
    };

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      if (width <= 0 || height <= 0) {
        animId = requestAnimationFrame(render);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "screen";

      let state: "connecting" | "listening" | "speaking" | "thinking" | "idle" = "idle";
      const curPhase = phaseRef.current;
      const muted = isMutedRef.current;

      if (muted || curPhase === "ended") {
        state = "idle";
      } else if (curPhase === "listening") {
        state = "listening";
      } else if (curPhase === "speaking") {
        state = "speaking";
      } else if (curPhase === "thinking") {
        state = "thinking";
      } else if (curPhase === "connecting") {
        state = "connecting";
      }

      const vol = micVolumeRef.current;
      const ampScale =
        1 + (curPhase === "listening" ? vol * 3.2 : curPhase === "speaking" ? 1.0 : 0.15);
      const yc = height / 2;

      waves.forEach((w) => {
        w.phase += w.speed;

        ctx.beginPath();
        ctx.moveTo(0, yc);

        for (let x = 0; x <= width; x += 2) {
          const t = x / width;
          // Exact SmartDukaan quadratic envelope curve
          const env = Math.pow(Math.sin(t * Math.PI), 2);
          const y = yc + w.amp * ampScale * env * Math.sin(x * w.freq + w.phase);
          ctx.lineTo(x, y);
        }

        ctx.lineTo(width, yc);
        ctx.closePath();

        ctx.fillStyle = w.color[state] || w.color.idle;
        ctx.fill();

        ctx.strokeStyle = w.stroke[state] || w.stroke.idle;
        ctx.lineWidth = w.lineWidth;
        ctx.stroke();
      });

      // Radiant central glow matching SmartDukaan
      const grad = ctx.createRadialGradient(width / 2, yc, 10, width / 2, yc, width / 2.5);
      grad.addColorStop(0, glowColors[state] || glowColors.idle);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    render();
    return () => {
      window.removeEventListener("resize", resizeCanvas);
      cancelAnimationFrame(animId);
    };
  }, [view]);

  // ============================================================
  // WEB SPEECH RECOGNITION (PARALLEL ULTRA-FAST STT)
  // ============================================================
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      const rec = new SpeechRecognition();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 1;

      rec.onresult = (event: any) => {
        let final = "";
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          if (item.isFinal) {
            final += item[0].transcript;
          } else {
            interim += item[0].transcript;
          }
        }

        const heard = (final || interim).trim();

        // ── INSTANT BARGE-IN: If assistant is speaking and user says anything, STOP assistant immediately! ──
        if (heard && phaseRef.current === "speaking" && !isMutedRef.current) {
          stopAssistantSpeech();
          setPhase("listening");
          phaseRef.current = "listening";
          isProcessingTurnRef.current = false;
          if (!isRecordingRef.current && streamRef.current?.active) {
            startListeningSession();
          }
        }

        if (heard) {
          latestSpeechTextRef.current = heard;
          speechDetectedRef.current = true;
        }

        // Fast immediate trigger on isFinal if Chrome emits it early
        if (
          final.trim() &&
          phaseRef.current === "listening" &&
          !isProcessingTurnRef.current &&
          !isMutedRef.current
        ) {
          clearTimeout(speechSilenceTimerRef.current);
          isProcessingTurnRef.current = true;
          const text = final.trim();
          latestSpeechTextRef.current = "";
          stopListeningSession();
          handleUserTurn(text);
          return;
        }

        // Fast 380ms silence debounce for interim speech:
        // Eliminates Chrome's 2.5s delay! The second the user stops talking,
        // it triggers the turn after only 380ms of silence!
        if (heard && phaseRef.current === "listening" && !isMutedRef.current) {
          clearTimeout(speechSilenceTimerRef.current);
          speechSilenceTimerRef.current = setTimeout(() => {
            const currentText = latestSpeechTextRef.current.trim();
            if (
              currentText &&
              phaseRef.current === "listening" &&
              !isProcessingTurnRef.current &&
              !isMutedRef.current
            ) {
              isProcessingTurnRef.current = true;
              latestSpeechTextRef.current = "";
              stopListeningSession();
              handleUserTurn(currentText);
            }
          }, 380);
        }
      };

      rec.onerror = (e: any) => {
        console.log("[speech-rec] notice:", e?.error);
      };

      rec.onend = () => {
        if (
          continuousRef.current &&
          (phaseRef.current === "listening" || phaseRef.current === "speaking") &&
          !isProcessingTurnRef.current &&
          !isMutedRef.current
        ) {
          try { rec.start(); } catch { }
        }
      };

      recognitionRef.current = rec;
    } catch (e) {
      console.warn("[speech-rec] init skipped:", e);
    }

    return () => {
      try {
        recognitionRef.current?.stop();
      } catch { }
    };
  }, []);

  function pickFemaleVoice(targetLang: string) {
    const voices = voicesRef.current;
    const femaleHints = [
      "neerja", "swara", "heera", "kalpana", "lekha",
      "veena", "priya", "female", "zira", "samantha", "moira", "tessa",
    ];
    const langPrefix = targetLang.split("-")[0].toLowerCase();

    const exactLang = voices.filter(
      (v) => v.lang.toLowerCase() === targetLang.toLowerCase(),
    );
    const samePrefix = voices.filter((v) =>
      v.lang.toLowerCase().startsWith(langPrefix),
    );
    const indianLang = voices.filter((v) => /^(en-in|hi-in)$/i.test(v.lang));

    for (const pool of [exactLang, indianLang, samePrefix]) {
      if (!pool.length) continue;
      const match = pool.find((v) =>
        femaleHints.some((h) => v.name.toLowerCase().includes(h)),
      );
      if (match) return match;
    }

    const fallbackPool = samePrefix.length ? samePrefix : voices;
    return (
      fallbackPool.find((v) => !/male/i.test(v.name)) ||
      fallbackPool[0] ||
      null
    );
  }

  function stopAssistantSpeech() {
    if (speechWatchdogRef.current) {
      clearTimeout(speechWatchdogRef.current);
      speechWatchdogRef.current = null;
    }
    if (ttsAbortControllerRef.current) {
      try {
        ttsAbortControllerRef.current.abort();
      } catch { }
      ttsAbortControllerRef.current = null;
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
      } catch { }
    }
    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch { }
    }
  }

  function fallbackSpeech(text: string, onFinish: () => void) {
    if (phaseRef.current !== "speaking" || isProcessingTurnRef.current) {
      return;
    }
    if (!("speechSynthesis" in window)) {
      onFinish();
      return;
    }
    const spoken = text.replace(/\bDeific\b/gi, "Deeific");
    const utter = new SpeechSynthesisUtterance(spoken);
    utter.rate = 1.0;
    utter.pitch = 1.05;
    utter.lang = "en-IN";
    const voice = pickFemaleVoice("en-IN");
    if (voice) {
      utter.voice = voice;
    }

    utter.onend = () => onFinish();
    utter.onerror = () => onFinish();

    try {
      window.speechSynthesis.cancel();
      setTimeout(() => {
        if (phaseRef.current === "speaking" && !isProcessingTurnRef.current) {
          window.speechSynthesis.speak(utter);
        }
      }, 50);
    } catch {
      onFinish();
    }
  }

  function playAudioBase64(base64: string, fallbackText: string) {
    if (isMutedRef.current) return;
    stopAssistantSpeech();
    stopListeningSession(true);
    setPhase("speaking");
    isProcessingTurnRef.current = false;
    latestSpeechTextRef.current = "";

    // Keep recognition active to detect user interruption
    if (recognitionRef.current && continuousRef.current && !isMutedRef.current) {
      try { recognitionRef.current.start(); } catch { }
    }

    let finished = false;
    const watchdog = setTimeout(() => {
      if (!finished && continuousRef.current) {
        finished = true;
        startListeningSession();
      }
    }, Math.min(Math.max(fallbackText.length * 85, 4500), 12000));
    speechWatchdogRef.current = watchdog;

    const onFinish = () => {
      if (finished) return;
      finished = true;
      if (speechWatchdogRef.current) {
        clearTimeout(speechWatchdogRef.current);
        speechWatchdogRef.current = null;
      }
      if (continuousRef.current && !isMutedRef.current) {
        startListeningSession();
      }
    };

    try {
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      audio.src = `data:audio/mpeg;base64,${base64}`;
      audio.onended = () => onFinish();
      audio.onerror = () => {
        fallbackSpeech(fallbackText, onFinish);
      };
      const p = audio.play();
      if (p && p.catch) {
        p.catch(() => {
          fallbackSpeech(fallbackText, onFinish);
        });
      }
    } catch {
      fallbackSpeech(fallbackText, onFinish);
    }
  }

  // Sends recorded voice audio to backend unified /web/turn endpoint (Whisper -> Groq LLM -> ElevenLabs)
  async function processRecordedAudio(blob: Blob) {
    if (isMutedRef.current) return;
    if (!blob || blob.size < 1200) {
      if (continuousRef.current && phaseRef.current === "listening" && !isMutedRef.current) {
        setTimeout(() => startListeningSession(), 120);
      }
      return;
    }

    isProcessingTurnRef.current = true;
    setPhase("thinking");

    // 1. Unified low-latency turn endpoint
    try {
      const res = await fetch(`${API_BASE}/web/turn`, {
        method: "POST",
        headers: {
          "Content-Type": blob.type || "audio/webm",
          "X-Session-Id": sessionIdRef.current,
        },
        body: blob,
      });

      if (res.ok) {
        const data = await res.json();
        const reply = (data.reply || "").trim();

        if (data.audioBase64) {
          playAudioBase64(data.audioBase64, reply);
          return;
        } else if (reply) {
          speakThenListen(reply);
          return;
        }
      }
    } catch (err) {
      console.warn("[turn] endpoint notice:", err);
    }

    // 2. Fallback to /stt + /chat if unified turn was unavailable
    try {
      const res = await fetch(`${API_BASE}/web/stt`, {
        method: "POST",
        headers: {
          "Content-Type": blob.type || "audio/webm",
        },
        body: blob,
      });

      if (res.ok) {
        const data = await res.json();
        const transcribedText = (data.text || "").trim();
        if (transcribedText.length > 0) {
          await handleUserTurn(transcribedText);
          return;
        }
      }
    } catch (err) {
      console.warn("[stt] error:", err);
    }

    if (continuousRef.current && !isMutedRef.current) {
      isProcessingTurnRef.current = false;
      startListeningSession();
    }
  }

  function stopListeningSession(keepRecognition = false) {
    if (!keepRecognition) {
      clearInterval(vadIntervalRef.current);
    }
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    clearTimeout(speechSilenceTimerRef.current);
    speechSilenceTimerRef.current = null;
    setMicVolume(0);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch { }
    }
    isRecordingRef.current = false;

    if (!keepRecognition && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch { }
    }
  }

  function startListeningSession() {
    if (!continuousRef.current) return;
    if (isRecordingRef.current) return;
    if (isMutedRef.current) return;

    const stream = streamRef.current;
    if (!stream || !stream.active) {
      startCall();
      return;
    }

    setPhase("listening");
    speechDetectedRef.current = false;
    isProcessingTurnRef.current = false;
    audioChunksRef.current = [];

    let mimeType = "audio/webm;codecs=opus";
    if (typeof MediaRecorder !== "undefined") {
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported("audio/webm")) {
          mimeType = "audio/webm";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        } else {
          mimeType = "";
        }
      }
    }

    try {
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        isRecordingRef.current = false;
        clearInterval(vadIntervalRef.current);
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
        setMicVolume(0);

        if (!isProcessingTurnRef.current && !isMutedRef.current) {
          const chunks = audioChunksRef.current;
          if (chunks.length > 0 && speechDetectedRef.current) {
            const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            await processRecordedAudio(blob);
          } else {
            if (continuousRef.current && phaseRef.current === "listening" && !isMutedRef.current) {
              setTimeout(() => startListeningSession(), 120);
            }
          }
        }
      };

      recorder.start(100);
      isRecordingRef.current = true;
      mediaRecorderRef.current = recorder;
    } catch (err) {
      console.warn("[mediaRecorder] error:", err);
    }

    // Web Audio VAD: fast 40ms audio poll + sub-40ms barge-in detection
    const analyser = analyserRef.current;
    if (analyser) {
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = setInterval(() => {
        if (isMutedRef.current) return;

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = avg / 110;
        setMicVolume(Math.min(1, normalized));

        // ── DUAL BARGE-IN: Audio amplitude threshold instantly silences assistant audio ──
        if (phaseRef.current === "speaking" && avg > 22) {
          stopAssistantSpeech();
          setPhase("listening");
          phaseRef.current = "listening";
          isProcessingTurnRef.current = false;
          speechDetectedRef.current = true;
          if (!isRecordingRef.current && streamRef.current?.active) {
            startListeningSession();
          }
          return;
        }

        if (phaseRef.current !== "listening" || !isRecordingRef.current) {
          return;
        }

        // Detect user speech above background threshold
        if (avg > 13) {
          speechDetectedRef.current = true;
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        } else if (speechDetectedRef.current && !silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            if (isRecordingRef.current && mediaRecorderRef.current?.state === "recording") {
              try {
                mediaRecorderRef.current.stop();
              } catch { }
            }
          }, 320);
        }
      }, 40);
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch { }
    }
  }

  // Speaks AI reply using ElevenLabs via backend, falling back to browser neural voice
  async function speakThenListen(text: string) {
    if (isMutedRef.current) return;
    stopAssistantSpeech();
    stopListeningSession(true);
    setPhase("speaking");
    isProcessingTurnRef.current = false;
    latestSpeechTextRef.current = "";

    // Keep recognition active to detect user interruption
    if (recognitionRef.current && continuousRef.current && !isMutedRef.current) {
      try { recognitionRef.current.start(); } catch { }
    }

    let finished = false;
    const watchdog = setTimeout(() => {
      if (!finished && continuousRef.current) {
        finished = true;
        startListeningSession();
      }
    }, Math.min(Math.max(text.length * 85, 4500), 12000));
    speechWatchdogRef.current = watchdog;

    const onFinish = () => {
      if (finished) return;
      finished = true;
      if (speechWatchdogRef.current) {
        clearTimeout(speechWatchdogRef.current);
        speechWatchdogRef.current = null;
      }
      if (continuousRef.current && !isMutedRef.current) {
        startListeningSession();
      }
    };

    // 1. Try ElevenLabs TTS audio from backend
    try {
      const controller = new AbortController();
      ttsAbortControllerRef.current = controller;
      const fetchTimer = setTimeout(() => controller.abort(), 6500);

      const res = await fetch(`${API_BASE}/web/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      clearTimeout(fetchTimer);

      if (phaseRef.current !== "speaking" || isProcessingTurnRef.current) {
        return;
      }

      if (res.ok) {
        const blob = await res.blob();
        if (phaseRef.current !== "speaking" || isProcessingTurnRef.current) {
          return;
        }
        const audioUrl = URL.createObjectURL(blob);
        const audio = audioRef.current || new Audio();
        audioRef.current = audio;
        audio.src = audioUrl;

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          onFinish();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          onFinish();
        };

        const playPromise = audio.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(() => {
            URL.revokeObjectURL(audioUrl);
            fallbackSpeech(text, onFinish);
          });
        }
        return;
      }
    } catch {
      // Fallback
    }

    if (phaseRef.current !== "speaking" || isProcessingTurnRef.current) {
      return;
    }

    // 2. Fallback to browser neural voice
    fallbackSpeech(text, onFinish);
  }

  // Called to start hands-free call on launcher click
  const startCall = async () => {
    continuousRef.current = true;
    setIsMuted(false);
    setView("live");
    setPhase("connecting");

    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    try {
      audioRef.current.src =
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
      const p = audioRef.current.play();
      if (p && p.catch) p.catch(() => { });
    } catch { }

    // Request & persist microphone stream
    let stream = streamRef.current;
    if (!stream || !stream.active) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;
      } catch (e) {
        console.warn("[mic] permission denied:", e);
        setPhase("ended");
        return;
      }
    }

    // Initialize Web Audio context for VAD
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx && !audioContextRef.current) {
        const ctx = new AudioCtx();
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioContextRef.current = ctx;
        analyserRef.current = analyser;
      }
    } catch (e) {
      console.warn("[audio-ctx] error:", e);
    }

    // Immediate greeting without waiting for extra network roundtrip
    const greeting =
      "Hello! Welcome to Deific Digital. I am your AI assistant. How can I assist you today?";
    speakThenListen(greeting);

    // Register session on backend asynchronously (saves to DB in background)
    fetch(`${API_BASE}/web/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionIdRef.current }),
    }).catch(() => { });
  };

  // Called with user speech text -> sends to /web/chat (saves to DB in background)
  const handleUserTurn = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      if (continuousRef.current && !isMutedRef.current) startListeningSession();
      return;
    }
    setPhase("thinking");

    try {
      const res = await fetch(`${API_BASE}/web/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          message: trimmed,
          interrupted: phaseRef.current === "speaking" || phaseRef.current === "listening",
        }),
      });
      const data = await res.json();
      const reply: string =
        data.reply ||
        "I am here to help you with Deific Digital's services. What would you like to know?";

      if (data.audioBase64) {
        playAudioBase64(data.audioBase64, reply);
      } else {
        speakThenListen(reply);
      }
    } catch {
      const msg = "Sorry, connection error. Please try again.";
      speakThenListen(msg);
    }
  };

  const toggleMute = () => {
    if (isMuted) {
      // Resume / unmute
      setIsMuted(false);
      isMutedRef.current = false;
      if (continuousRef.current) {
        startListeningSession();
      }
    } else {
      // Mute / pause
      setIsMuted(true);
      isMutedRef.current = true;
      stopAssistantSpeech();
      stopListeningSession();
      setPhase("listening");
    }
  };

  const endCall = () => {
    continuousRef.current = false;
    stopAssistantSpeech();
    stopListeningSession();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch { }
      audioContextRef.current = null;
    }
    audioRef.current = null;
    setPhase("ended");
    setMicVolume(0);
    setIsMuted(false);
  };

  const closePanel = () => {
    endCall();
    setView("closed");
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
        /* ── SmartDukaan Exact Liquid-Blob Launcher ── */
        #sd-chat-fab {
          position: fixed; right: 28px; bottom: 28px; width: 58px; height: 58px;
          border-radius: 50%; color: #fff; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center; z-index: 99998;
          transition: transform .2s ease, box-shadow .2s ease;
          background: linear-gradient(135deg, #ff8a5b, #e2253b 55%, #b3122a);
          animation: sd-blob 6s ease-in-out infinite, sd-blobGlow 3s ease-in-out infinite;
        }
        #sd-chat-fab:hover { transform: scale(1.08); }
        @keyframes sd-blob {
          0%, 100% { border-radius: 42% 58% 70% 30% / 45% 45% 55% 55%; }
          50% { border-radius: 70% 30% 45% 55% / 55% 60% 40% 45%; }
        }
        @keyframes sd-blobGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(226,37,59,.45), 0 4px 16px rgba(226,37,59,.4); }
          50% { box-shadow: 0 0 0 8px rgba(226,37,59,0), 0 6px 22px rgba(226,37,59,.55); }
        }
        #sd-chat-fab .sd-mic {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 5;
        }
        #sd-chat-fab .sd-mic svg { width: 25px; height: 25px; fill: #fff; display: block; }
        #sd-chat-badge {
          position: absolute; top: -2px; right: -2px; width: 14px; height: 14px;
          border-radius: 50%; background: #10B981; border: 2.5px solid #fff; z-index: 6;
        }

        /* ── SmartDukaan Exact Cosmic Dark Glassmorphic Container ── */
        #sd-chat-container {
          position: fixed; right: 20px; bottom: 88px; width: 380px; max-width: calc(100vw - 32px);
          height: 560px; max-height: calc(100vh - 110px);
          background:
            radial-gradient(ellipse 80% 60% at 10% 20%, rgba(211,47,47,.20), transparent 60%),
            radial-gradient(ellipse 70% 60% at 90% 10%, rgba(59,130,246,.20), transparent 65%),
            radial-gradient(ellipse 80% 70% at 50% 90%, rgba(139,92,246,.25), transparent 60%),
            #0b0b14 !important;
          -webkit-backdrop-filter: blur(28px) saturate(180%);
          backdrop-filter: blur(28px) saturate(180%);
          border-radius: 24px;
          box-shadow: 0 20px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08);
          display: flex; flex-direction: column; overflow: hidden;
          z-index: 99999; font-family: 'Poppins', system-ui, -apple-system, sans-serif;
          animation: sd-modalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes sd-modalIn {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* ── SmartDukaan Glowing Aurora Outer Ring ── */
        .sd-aurora {
          position: absolute; inset: -2px; border-radius: 26px; pointer-events: none;
          background: conic-gradient(from 0deg, #ff4d6d, #7928ca, #0070f3, #00dfd8, #ff4d6d);
          opacity: 0.32; filter: blur(12px); -webkit-filter: blur(12px);
          z-index: 1; animation: sd-auroraSpin 14s linear infinite;
        }
        @keyframes sd-auroraSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* ── Top Status Pill ── */
        .sd-voice-status {
          position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
          font-size: 12px; letter-spacing: .4px; font-weight: 500;
          color: rgba(255, 255, 255, 0.85);
          background: rgba(255, 255, 255, 0.12);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          backdrop-filter: blur(20px) saturate(180%);
          padding: 6px 16px; border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          box-shadow: 0 6px 20px rgba(0,0,0,.25);
          z-index: 10; pointer-events: none;
          white-space: nowrap; max-width: calc(100% - 70px); text-align: center;
          transition: all 0.3s ease;
        }
        .sd-voice-status.listening { color: #34d399; border-color: rgba(52, 211, 153, 0.35); }
        .sd-voice-status.speaking { color: #f43f5e; border-color: rgba(244, 63, 94, 0.35); }
        .sd-voice-status.thinking { color: #c084fc; border-color: rgba(192, 132, 252, 0.35); }
        .sd-voice-status.muted { color: #fbbf24; border-color: rgba(251, 191, 36, 0.35); }

        /* ── Top-Right Close Button (✕) ── */
        .sd-voice-x {
          position: absolute; top: 16px; right: 16px; z-index: 10;
          width: 32px; height: 32px; border-radius: 50%;
          background: rgba(255, 255, 255, 0.14); border: 1px solid rgba(255, 255, 255, 0.2);
          color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
          font-size: 16px; font-weight: 600; transition: transform .15s ease, background .15s ease;
        }
        .sd-voice-x:hover { transform: scale(1.08); background: rgba(255, 255, 255, 0.28); }

        /* ── Center Stage Visualizer ── */
        .sd-wave-container {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
          width: 100%; padding: 0 20px; z-index: 5; gap: 12px;
        }

        /* ── SmartDukaan Center Mic Circle Outline with State Glow ── */
        .sd-mic-circle-outline {
          width: 78px; height: 78px; border-radius: 50%;
          border: 1.5px solid rgba(255, 255, 255, 0.18);
          background: radial-gradient(circle, rgba(168, 85, 247, 0.12) 0%, transparent 80%);
          display: flex; align-items: center; justify-content: center;
          color: #a855f7; box-shadow: 0 0 22px rgba(168, 85, 247, 0.2);
          transition: border-color 0.3s ease, color 0.3s ease, box-shadow 0.3s ease;
          cursor: pointer; pointer-events: auto;
        }
        .sd-mic-circle-outline:hover { transform: scale(1.04); }
        .sd-mic-circle-outline.listening {
          color: #34d399; border-color: rgba(52, 211, 153, 0.6); box-shadow: 0 0 28px rgba(52, 211, 153, 0.45);
        }
        .sd-mic-circle-outline.speaking {
          color: #f43f5e; border-color: rgba(244, 63, 94, 0.6); box-shadow: 0 0 28px rgba(244, 63, 94, 0.45);
        }
        .sd-mic-circle-outline.thinking {
          color: #c084fc; border-color: rgba(192, 132, 252, 0.6); box-shadow: 0 0 28px rgba(192, 132, 252, 0.45);
        }
        .sd-mic-circle-outline.muted {
          color: #f43f5e !important; border-color: rgba(244, 63, 94, 0.7) !important;
          box-shadow: 0 0 28px rgba(244, 63, 94, 0.45) !important;
          background: radial-gradient(circle, rgba(244, 63, 94, 0.16) 0%, transparent 80%) !important;
        }
        .sd-mic-circle-outline svg {
          width: 32px; height: 32px; stroke-linecap: round; stroke-linejoin: round; fill: none;
        }

        .sd-voice-assistant-title {
          font-size: 16px; font-weight: 300; letter-spacing: 2px;
          color: rgba(255, 255, 255, 0.85); text-transform: lowercase; margin-bottom: 2px;
        }
        .sd-voice-assistant-sub {
          font-size: 13px; font-weight: 300; letter-spacing: 2.5px;
          color: rgba(255, 255, 255, 0.5); text-transform: lowercase; margin-top: 6px;
        }

        #sd-wave-canvas {
          width: 100%; height: 120px; display: block;
        }
      `}} />

      {/* ── Liquid-Blob Animated Launcher Button ── */}
      <button
        id="sd-chat-fab"
        className="sd-voice-launcher"
        onClick={() => {
          if (view === "live") {
            closePanel();
          } else {
            startCall();
          }
        }}
        aria-label="Deific Voice Assistant"
      >
        <span className="sd-mic">
          {view === "live" ? (
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          )}
        </span>
        <span id="sd-chat-badge" />
      </button>

      {/* ── Exact SmartDukaan Cosmic Dark AI Voice Assistant Modal ── */}
      <div
        id="sd-chat-container"
        style={{ display: view === "live" ? "flex" : "none" }}
      >
        {/* Animated Aurora Edge */}
        <div className="sd-aurora" />

        {/* Top Status Pill */}
        <div
          className={`sd-voice-status ${isMuted || phase === "ended"
            ? "muted"
            : phase === "listening"
              ? "listening"
              : phase === "speaking"
                ? "speaking"
                : phase === "thinking"
                  ? "thinking"
                  : "connecting"
            }`}
        >
          {isMuted || phase === "ended"
            ? "Muted — tap mic to resume"
            : phase === "listening"
              ? micVolume > 0.12
                ? "Hearing voice…"
                : "Speak naturally"
              : phase === "speaking"
                ? "Speaking…"
                : phase === "thinking"
                  ? "Thinking…"
                  : "Connecting…"}
        </div>

        {/* Top-Right Glass Close Button (✕) */}
        <button className="sd-voice-x" aria-label="Close" onClick={closePanel}>
          ✕
        </button>

        {/* Center Stage Visualizer */}
        <div className="sd-wave-container">
          {/* SmartDukaan Mic Circle Outline Toggle */}
          <div
            className={`sd-mic-circle-outline ${isMuted || phase === "ended"
              ? "muted"
              : phase === "listening"
                ? "listening"
                : phase === "speaking"
                  ? "speaking"
                  : phase === "thinking"
                    ? "thinking"
                    : ""
              }`}
            onClick={toggleMute}
            title={isMuted ? "Tap to resume" : "Tap to mute"}
          >
            {isMuted ? (
              // SmartDukaan Muted Mic SVG
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="3" x2="21" y2="21" />
                <path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.6" />
                <path d="M18.9 13A7 7 0 0 1 5 11v-1" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            ) : (
              // SmartDukaan Active Mic SVG
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                <line x1="12" y1="18" x2="12" y2="22" />
              </svg>
            )}
          </div>

          <div className="sd-voice-assistant-title">
            {isMuted ? "tap to resume" : "tap to mute"}
          </div>

          {/* Exact SmartDukaan Wave Canvas */}
          <canvas ref={canvasRef} id="sd-wave-canvas" />

          <div className="sd-voice-assistant-sub">
            voice assistant
          </div>
        </div>
      </div>
    </>
  );
}
