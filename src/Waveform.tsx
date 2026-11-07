type Props = {
  peaks: number[] | null;
  /** 0 a 1, posição atual da reprodução neste arquivo. */
  progress: number;
  playing?: boolean;
  label: string;
  onSeek: (ratio: number) => void;
};

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/**
 * Onda estática com a linha do tempo. A onda vem de `audio_peaks`, que decodifica
 * o arquivo local no backend, então nada é enviado para fora e o desenho não
 * depende de carregar o áudio inteiro no webview.
 */
export function Waveform({ peaks, progress, playing = false, label, onSeek }: Props) {
  const ratio = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));

  function seekFrom(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    onSeek(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)));
  }

  return (
    <div
      className={`wave${peaks && peaks.length > 0 ? '' : ' is-empty'}${playing ? ' is-playing' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      style={{ ['--wave-played' as string]: `${ratio * 100}%` }}
      onPointerDown={event => {
        if (!peaks || peaks.length === 0) return;
        seekFrom(event);
        // Capturar o ponteiro é conveniência para arrastar fora da onda; se o
        // webview recusar o id, a busca já aconteceu e o clique não se perde.
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* sem captura */ }
      }}
      onPointerMove={event => {
        if (!peaks || peaks.length === 0) return;
        if (event.buttons !== 1) return;
        seekFrom(event);
      }}
      onKeyDown={event => {
        const step = event.shiftKey ? 0.05 : 0.01;
        if (event.key === 'ArrowRight') { event.preventDefault(); onSeek(Math.min(1, ratio + step)); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); onSeek(Math.max(0, ratio - step)); }
        if (event.key === 'Home') { event.preventDefault(); onSeek(0); }
        if (event.key === 'End') { event.preventDefault(); onSeek(1); }
      }}
    >
      {peaks && peaks.length > 0 ? (
        <svg viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none" aria-hidden="true">
          {peaks.map((value, index) => {
            const height = Math.max(4, Math.min(100, (value / 255) * 100));
            return (
              <rect
                key={index}
                x={index}
                y={50 - height / 2}
                width={0.62}
                height={height}
                rx={0.3}
              />
            );
          })}
        </svg>
      ) : (
        <span className="wave-placeholder" aria-hidden="true" />
      )}
      <span className="wave-playhead" aria-hidden="true" />
    </div>
  );
}
