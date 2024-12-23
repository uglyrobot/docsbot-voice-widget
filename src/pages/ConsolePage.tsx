/**
 * Running a local relay server will allow you to hide your API key
 * and run custom logic on the server
 *
 * Set the local relay server address to:
 * REACT_APP_LOCAL_RELAY_SERVER_URL=http://localhost:8081
 *
 * This will also require you to set OPENAI_API_KEY= in a `.env` file
 * You can run it with `npm run relay`, in parallel with `npm start`
 */
const LOCAL_RELAY_SERVER_URL: string = 'http://localhost:9000/teams/nG4F5A3BFSBzdYc5TZIX/bots/uy8srweloFNgRadNtwvf/voice';

import { useEffect, useRef, useCallback, useState } from 'react';

import { RealtimeClient } from '../lib/realtime-api-beta';
import { ItemType } from '../lib/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';

import { X, ArrowUp, ArrowDown } from 'react-feather';
import { Voice } from '../components/voice/Voice';

import './ConsolePage.scss';
import { isJsxOpeningLikeElement } from 'typescript';


/**
 * Type for all event logs
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: { [key: string]: any };
}

export function ConsolePage() {

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
    new WavStreamPlayer({ sampleRate: 24000 })
  );
  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient({ url: LOCAL_RELAY_SERVER_URL })
  );

  /**
   * References for
   * - Rendering audio visualization (canvas)
   * - Autoscrolling event logs
   * - Timing delta for event log displays
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const eventsScrollHeightRef = useRef(0);
  const eventsScrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   */
  const [items, setItems] = useState<ItemType[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [expandedEvents, setExpandedEvents] = useState<{
    [key: string]: boolean;
  }>({});
  const [isConnected, setIsConnected] = useState(false);
  const [canPushToTalk, setCanPushToTalk] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [latestTranscript, setLatestTranscript] = useState<string>("");

  // Add new state variable for price
  const [totalPrice, setTotalPrice] = useState(0);

  // Add new state variables for the timer
  const [timerSeconds, setTimerSeconds] = useState(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Add new state variables for token usage and costs
  const [textInputTokens, setTextInputTokens] = useState(0);
  const [audioInputTokens, setAudioInputTokens] = useState(0);
  const [textOutputTokens, setTextOutputTokens] = useState(0);
  const [audioOutputTokens, setAudioOutputTokens] = useState(0);

  const [textInputCost, setTextInputCost] = useState(0);
  const [audioInputCost, setAudioInputCost] = useState(0);
  const [textOutputCost, setTextOutputCost] = useState(0);
  const [audioOutputCost, setAudioOutputCost] = useState(0);

  // Add new state variables for cached tokens
  const [cachedTextTokens, setCachedTextTokens] = useState(0);
  const [cachedAudioTokens, setCachedAudioTokens] = useState(0);

  /**
   * Utility for formatting the timing of logs
   */
  const formatTime = useCallback((timestamp: string) => {
    const startTime = startTimeRef.current;
    const t0 = new Date(startTime).valueOf();
    const t1 = new Date(timestamp).valueOf();
    const delta = t1 - t0;
    const hs = Math.floor(delta / 10) % 100;
    const s = Math.floor(delta / 1000) % 60;
    const m = Math.floor(delta / 60_000) % 60;
    const pad = (n: number) => {
      let s = n + '';
      while (s.length < 2) {
        s = '0' + s;
      }
      return s;
    };
    return `${pad(m)}:${pad(s)}.${pad(hs)}`;
  }, []);

  /**
   * Connect to conversation:
   * WavRecorder taks speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

    // Set state variables
    startTimeRef.current = new Date().toISOString();
    setRealtimeEvents([]);
    setItems(client.conversation.getItems());
    
    // Reset all counts and costs
    setTotalPrice(0);
    setTextInputTokens(0);
    setAudioInputTokens(0);
    setTextOutputTokens(0);
    setAudioOutputTokens(0);
    setTextInputCost(0);
    setAudioInputCost(0);
    setTextOutputCost(0);
    setAudioOutputCost(0);

    // Connect to microphone
    try {
      await wavRecorder.begin();
    } catch (error) {
      console.error("Error connecting to microphone:", error);
      alert("Microphone access was blocked. Please grant permission and try again.");
      setIsConnected(false);
      return false;
    }

    // Connect to audio output
    await wavStreamPlayer.connect();

    // Connect to realtime API
    await client.connect();

    if (client.getTurnDetectionType() === 'server_vad') {
       await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
    await client.waitForSessionCreated();
    setIsConnected(true);
    startRecording();

    return true;
  }, []);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);
    setIsRecording(false);
    // Remove these two lines to keep events and conversation items
    // setRealtimeEvents([]);
    // setItems([]);

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    const wavStreamPlayer = wavStreamPlayerRef.current;
    await wavStreamPlayer.interrupt();

    // Stop the timer
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
  }, []);

  const deleteConversationItem = useCallback(async (id: string) => {
    const client = clientRef.current;
    client.deleteItem(id);
  }, []);

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = async () => {
    setIsRecording(true);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const trackSampleOffset = await wavStreamPlayer.interrupt();
    if (trackSampleOffset?.trackId) {
      const { trackId, offset } = trackSampleOffset;
      await client.cancelResponse(trackId, offset);
    }
    await wavRecorder.record((data) => client.appendInputAudio(data.mono));
  };

  /**
   * In push-to-talk mode, stop recording
   */
  const stopRecording = async () => {
    setIsRecording(false);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.pause();
    client.createResponse();
  };

  /**
   * Switch between Manual <> VAD mode for communication
   */
  const changeTurnEndType = async (value: string) => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    if (value === 'none' && wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }
    client.updateSession({
      turn_detection: value === 'none' ? null : { type: 'server_vad' },
    });
    if (value === 'server_vad' && client.isConnected()) {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
    setCanPushToTalk(value === 'none');
  };

  /**
   * Auto-scroll the event logs
   */
  useEffect(() => {
    if (eventsScrollRef.current) {
      const eventsEl = eventsScrollRef.current;
      const scrollHeight = eventsEl.scrollHeight;
      // Only scroll if height has just changed
      if (scrollHeight !== eventsScrollHeightRef.current) {
        eventsEl.scrollTop = scrollHeight;
        eventsScrollHeightRef.current = scrollHeight;
      }
    }
  }, [realtimeEvents]);

  /**
   * Auto-scroll the conversation logs
   */
  useEffect(() => {
    const conversationEls = [].slice.call(
      document.body.querySelectorAll('[data-conversation-content]')
    );
    for (const el of conversationEls) {
      const conversationEl = el as HTMLDivElement;
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }, [items]);


  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    // Get refs
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;

    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      setRealtimeEvents((realtimeEvents) => {
        const lastEvent = realtimeEvents[realtimeEvents.length - 1];
        if (lastEvent?.event.type === realtimeEvent.event.type) {
          // if we receive multiple events in a row, aggregate them for display purposes
          lastEvent.count = (lastEvent.count || 0) + 1;
          return realtimeEvents.slice(0, -1).concat(lastEvent);
        } else {
          return realtimeEvents.concat(realtimeEvent);
        }
      });

      // Update the price calculation in the 'realtime.event' handler
      if (realtimeEvent.event.type === 'response.done') {
        const usage = realtimeEvent.event.response.usage;
        const newTextInputTokens = usage.input_token_details.text_tokens;
        const newAudioInputTokens = usage.input_token_details.audio_tokens;
        const newCachedTextTokens = usage.input_token_details.cached_tokens_details.text_tokens;
        const newCachedAudioTokens = usage.input_token_details.cached_tokens_details.audio_tokens;
        const newTextOutputTokens = usage.output_token_details.text_tokens;
        const newAudioOutputTokens = usage.output_token_details.audio_tokens;

        // Regular token costs
        const newTextInputCost = ((newTextInputTokens - newCachedTextTokens) / 1000000) * .6;
        const newAudioInputCost = ((newAudioInputTokens - newCachedAudioTokens) / 1000000) * 10;
        const newTextOutputCost = (newTextOutputTokens / 1000000) * 2.4;
        const newAudioOutputCost = (newAudioOutputTokens / 1000000) * 20;

        // Cached token costs (50% off for text, 80% off for audio)
        const cachedTextCost = (newCachedTextTokens / 1000000) * .3; 
        const cachedAudioCost = (newCachedAudioTokens / 1000000) * .3;

        setTextInputTokens(prev => prev + newTextInputTokens);
        setAudioInputTokens(prev => prev + newAudioInputTokens);
        setCachedTextTokens(prev => prev + newCachedTextTokens);
        setCachedAudioTokens(prev => prev + newCachedAudioTokens);
        setTextOutputTokens(prev => prev + newTextOutputTokens);
        setAudioOutputTokens(prev => prev + newAudioOutputTokens);

        setTextInputCost(prev => prev + newTextInputCost + cachedTextCost);
        setAudioInputCost(prev => prev + newAudioInputCost + cachedAudioCost);
        setTextOutputCost(prev => prev + newTextOutputCost);
        setAudioOutputCost(prev => prev + newAudioOutputCost);

        setTotalPrice(prev => prev + newTextInputCost + newAudioInputCost + 
          newTextOutputCost + newAudioOutputCost + cachedTextCost + cachedAudioCost);
      }
    });
    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', async () => {
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        await client.cancelResponse(trackId, offset);
      }
    });
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        item.formatted.file = wavFile;
      }
      setItems(items);

      // Update the latest transcript if the item is from the assistant
      if (item.role === 'assistant' && item.formatted.transcript) {
        setLatestTranscript(item.formatted.transcript);
      }
    });

    // Update the 'close' event handler to properly clean up
    client.on('close', async () => {
      console.log('WebSocket connection closed');
      await disconnectConversation();
      
      // Stop the timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }

      // Clean up audio devices
      const wavRecorder = wavRecorderRef.current;
      await wavRecorder.end();
      await wavStreamPlayer.interrupt();

      // Optional: Clear conversation if desired
      // setItems([]);
      // setRealtimeEvents([]);
    });

    setItems(client.conversation.getItems());

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, [disconnectConversation]);

  // Update the handleVoiceStart function to explicitly return a Promise<boolean>
  const handleVoiceStart = async (): Promise<boolean> => {
    if (!isConnected) {
      return await connectConversation();
    }
    return true; // Return true if already connected
  };

  const handleVoiceStop = () => {
    if (isConnected) {
      disconnectConversation();
    }
  };

  // Modify the useEffect for timer cleanup to be more comprehensive
  useEffect(() => {
    // Start timer when connected
    if (isConnected) {
      setTimerSeconds(0);
      timerIntervalRef.current = setInterval(() => {
        setTimerSeconds(prev => prev + 1);
      }, 1000);
    }

    // Cleanup function that runs when component unmounts or isConnected changes
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [isConnected]); // Only re-run when connection status changes

  // Format the timer display
  const formatTimer = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  /**
   * Render the application
   */
  return (
    <div data-component="ConsolePage">
      <div className="content-top">
        <div className="content-title">
          <span>realtime console</span>
        </div>
        {/* Add timer display */}
        <div className="timer-display" style={{
          position: 'absolute',
          top: '10px',
          right: '20px',
          fontSize: '24px',
          fontWeight: 'bold',
        }}>
          {formatTimer(timerSeconds)}
        </div>
        {/* Move price display below the timer */}
        <div className="usage-table" style={{
          position: 'absolute',
          top: '50px',
          right: '20px',
          fontSize: '14px',
          fontWeight: 'bold',
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          padding: '12px',
        }}>
          <style>
            {`
              .usage-table table {
                border-collapse: collapse;
              }
              .usage-table th, .usage-table td {
                border: 1px solid #ddd;
                padding: 6px;
              }
            `}
          </style>
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th></th>
                <th>Input</th>
                <th>Cached</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Text</td>
                <td>{textInputTokens - cachedTextTokens} (${((textInputTokens - cachedTextTokens) / 1000000 * 5).toFixed(4)})</td>
                <td>{cachedTextTokens} (${(cachedTextTokens / 1000000 * 2.5).toFixed(4)})</td>
                <td>{textOutputTokens} (${textOutputCost.toFixed(4)})</td>
              </tr>
              <tr>
                <td>Audio</td>
                <td>{audioInputTokens - cachedAudioTokens} (${((audioInputTokens - cachedAudioTokens) / 1000000 * 100).toFixed(4)})</td>
                <td>{cachedAudioTokens} (${(cachedAudioTokens / 1000000 * 20).toFixed(4)})</td>
                <td>{audioOutputTokens} (${audioOutputCost.toFixed(4)})</td>
              </tr>
            </tbody>
          </table>
          <div style={{ 
            marginTop: '10px',
            fontSize: '24px',
            fontWeight: 'bold',
          }}>
            Total: ${totalPrice.toFixed(4)}
          </div>
        </div>
      </div>
      <div className="content-main">
        <div className="content-logs">
          <div className="content-block events">
            <div className="visualization">
              <div className="visualization-entry client">
                <canvas ref={clientCanvasRef} />
              </div>
              <div className="visualization-entry server">
                <canvas ref={serverCanvasRef} />
              </div>
            </div>
            <div className="content-block-title">events</div>
            <div className="content-block-body" ref={eventsScrollRef}>
              {!realtimeEvents.length && `awaiting connection...`}
              {realtimeEvents.map((realtimeEvent, i) => {
                const count = realtimeEvent.count;
                const event = { ...realtimeEvent.event };
                if (event.type === 'input_audio_buffer.append') {
                  event.audio = `[trimmed: ${event.audio.length} bytes]`;
                } else if (event.type === 'response.audio.delta') {
                  event.delta = `[trimmed: ${event.delta.length} bytes]`;
                }
                return (
                  <div className="event" key={event.event_id}>
                    <div className="event-timestamp">
                      {formatTime(realtimeEvent.time)}
                    </div>
                    <div className="event-details">
                      <div
                        className="event-summary"
                        onClick={() => {
                          // toggle event details
                          const id = event.event_id;
                          const expanded = { ...expandedEvents };
                          if (expanded[id]) {
                            delete expanded[id];
                          } else {
                            expanded[id] = true;
                          }
                          setExpandedEvents(expanded);
                        }}
                      >
                        <div
                          className={`event-source ${
                            event.type === 'error'
                              ? 'error'
                              : realtimeEvent.source
                          }`}
                        >
                          {realtimeEvent.source === 'client' ? (
                            <ArrowUp />
                          ) : (
                            <ArrowDown />
                          )}
                          <span>
                            {event.type === 'error'
                              ? 'error!'
                              : realtimeEvent.source}
                          </span>
                        </div>
                        <div className="event-type">
                          {event.type}
                          {count && ` (${count})`}
                        </div>
                      </div>
                      {!!expandedEvents[event.event_id] && (
                        <div className="event-payload">
                          {JSON.stringify(event, null, 2)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="content-block conversation">
            <div className="content-block-title">conversation</div>
            <div className="content-block-body" data-conversation-content>
              {!items.length && `awaiting connection...`}
              {items.map((conversationItem, i) => {
                return (
                  <div className="conversation-item" key={conversationItem.id}>
                    <div className={`speaker ${conversationItem.role || ''}`}>
                      <div>
                        {(
                          conversationItem.role || conversationItem.type
                        ).replaceAll('_', ' ')}
                      </div>
                      <div
                        className="close"
                        onClick={() =>
                          deleteConversationItem(conversationItem.id)
                        }
                      >
                        <X />
                      </div>
                    </div>
                    <div className={`speaker-content`}>
                      {/* tool response */}
                      {conversationItem.type === 'function_call_output' && (
                        <div>{conversationItem.formatted.output}</div>
                      )}
                      {/* tool call */}
                      {!!conversationItem.formatted.tool && (
                        <div>
                          {conversationItem.formatted.tool.name}(
                          {conversationItem.formatted.tool.arguments})
                        </div>
                      )}
                      {!conversationItem.formatted.tool &&
                        conversationItem.role === 'user' && (
                          <div>
                            {conversationItem.formatted.transcript ||
                              (conversationItem.formatted.audio?.length
                                ? '(awaiting transcript)'
                                : conversationItem.formatted.text ||
                                  '(item sent)')}
                          </div>
                        )}
                      {!conversationItem.formatted.tool &&
                        conversationItem.role === 'assistant' && (
                          <div>
                            {conversationItem.formatted.transcript ||
                              conversationItem.formatted.text ||
                              '(truncated)'}
                          </div>
                        )}
                      {conversationItem.formatted.file && (
                        <audio
                          src={conversationItem.formatted.file.url}
                          controls
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <Voice 
        onStart={handleVoiceStart} 
        onStop={handleVoiceStop} 
        isConnected={isConnected}
        clientAudio={wavRecorderRef}
        serverAudio={wavStreamPlayerRef}
        caption={latestTranscript} // Pass the latest transcript as the caption
      />
    </div>
  );
}