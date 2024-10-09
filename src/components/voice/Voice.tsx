import React, { useState, useEffect, useRef } from 'react';
import { Square, Loader } from 'react-feather';
import './Voice.scss';
import { WavRecorder, WavStreamPlayer } from '../../lib/wavtools/index.js';
import { WavRenderer } from '../../utils/wav_renderer';
import { ReactComponent as MicIcon } from './MicIcon.svg';
const markdown = require('micro-down');

interface VoiceProps {
  onStart: () => Promise<boolean>;
  onStop: () => void;
  isConnected: boolean;
  clientAudio: React.RefObject<WavRecorder>;
  serverAudio: React.RefObject<WavStreamPlayer>;
  caption: string;
}

export const Voice: React.FC<VoiceProps> = ({
  onStart,
  onStop,
  isConnected,
  clientAudio,
  serverAudio,
  caption,
}) => {
  const [state, setState] = useState<'closed' | 'starting' | 'open'>('closed');
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const [glowIntensity, setGlowIntensity] = useState([0, 0, 0, 0, 0]);
  const [captionHtml, setCaptionHtml] = useState('');

  useEffect(() => {
    if (state === 'starting' && isConnected) {
      setState('open');
    }
  }, [state, isConnected]);

  useEffect(() => {
    let isLoaded = true;
    let clientCtx: CanvasRenderingContext2D | null = null;
    let frameCount = 0;

    const render = () => {
      if (isLoaded) {
        frameCount++;
        if (frameCount % 2 === 0) {
          // Update every other frame
          if (clientCanvasRef.current) {
            const clientCanvas = clientCanvasRef.current;
            if (!clientCanvas.width || !clientCanvas.height) {
              clientCanvas.width = clientCanvas.offsetWidth;
              clientCanvas.height = clientCanvas.offsetHeight;
            }
            clientCtx = clientCtx || clientCanvas.getContext('2d');
            if (clientCtx && clientAudio.current) {
              clientCtx.clearRect(
                0,
                0,
                clientCanvas.width,
                clientCanvas.height
              );
              const result = clientAudio.current.recording
                ? clientAudio.current.getFrequencies('voice')
                : { values: new Float32Array([0]) };

              // Set global alpha for transparency
              clientCtx.globalAlpha = 1;

              WavRenderer.drawBars(
                clientCanvas,
                clientCtx,
                result.values,
                'white', // Changed to white as per instructions
                6,
                0,
                8
              );

              // Reset global alpha
              clientCtx.globalAlpha = 1.0;
            }
          }
          if (serverAudio.current) {
            const result = serverAudio.current.analyser
              ? serverAudio.current.getFrequencies('voice')
              : { values: new Float32Array([0]) };

            const values = WavRenderer.normalizeArray(
              result.values,
              8,
              true,
              true
            );

            // Normalize each item in the array to 0-0.8 range, assuming max value of 0.6
            const normalizedIntensity = values.map((value: number) => {
              const normalized = Math.min(1, Math.max(0, (value / 0.7) * 1));
              return normalized;
            });

            // Update glow intensity
            setGlowIntensity(normalizedIntensity);
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      isLoaded = false;
    };
  }, [clientAudio, serverAudio]);

  useEffect(() => {
    if (caption) {
      // Remove incomplete markdown images, but keep the alt text
      let filteredCaption = caption.replace(/!\[([^\]]*?)(?:\](?:\([^)]*)?)?$/gm, '$1');
      // Remove incomplete markdown links, but keep the link text
      filteredCaption = filteredCaption.replace(/\[([^\]]*?)(?:\](?:\([^)"]*(?:"[^"]*")?[^)]*)?)?$/gm, '$1');
      
      const parsedHtml = markdown.parse(filteredCaption);
      setCaptionHtml(parsedHtml);
    }
  }, [caption]);

  const handleClick = async () => {
    if (state === 'closed') {
      setState('starting');
      const success = await onStart();
      if (!success) {
        setState('closed');
      }
    } else if (state === 'starting' || state === 'open') {
      setState('closed');
      onStop();
    }
  };

  return (
    <div
      className={`docsbot-voice-widget ${state} ${
        isConnected ? 'connected' : 'disconnected'
      }`}
      onClick={handleClick}
    >
        {state === 'open' && captionHtml && (
          <div
            className="docsbot-voice-caption-bubble"
            dangerouslySetInnerHTML={{ __html: captionHtml }}
          />
        )}

        <div
        className="docsbot-voice-circle"
        style={state === 'open' ? {
          boxShadow: `
                0 0 0px hsla(33, 100%, 80%, ${glowIntensity[0]}),
                0 0 5px hsla(279,60%,77%, ${glowIntensity[1]}),
                0 0 10px hsla(280,84%,64%, ${glowIntensity[2]}),
                0 0 15px hsla(152,95%,75%, ${glowIntensity[3]}),
                0 0 20px hsla(215,95%,62%, ${glowIntensity[4]}),
                0 0 25px hsla(348,85%,64%, ${glowIntensity[5]}),
                0 0 30px hsla(239,91%,62%, ${glowIntensity[6]}),
                0 0 35px hsla(311,67%,68%, ${glowIntensity[7]})
              `,
        } : undefined}
      >
        {state === 'closed' ? (
          <MicIcon className="docsbot-voice-mic-icon" />
        ) : state === 'starting' ? (
          <div className="docsbot-voice-starting-state">
            <Loader className="docsbot-voice-spinner" />
          </div>
        ) : (
          <>
            <div className="docsbot-voice-gradient-background"></div>
            <div className="docsbot-voice-stop-icon-container">
              <Square className="docsbot-voice-stop-icon" />
            </div>
            <div className="docsbot-voice-canvas-container">
              <canvas ref={clientCanvasRef} className="docsbot-voice-client-canvas" />
              <div className="docsbot-voice-mic-icon-overlay"></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
