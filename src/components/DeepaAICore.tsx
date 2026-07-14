import React, { useState, useEffect, useRef } from "react";
import { Send, Sparkles, Bot, User, Image as ImageIcon, Loader2, AlertCircle } from "lucide-react";
import { ChatMessage } from "../types";

export default function DeepaAICore() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem("life_os_chat_messages");
    return saved ? JSON.parse(saved) : [
      {
        id: "welcome",
        text: "Hello! I am Deepa, your intelligent Life OS assistant. How can I help you organize your tasks, log your focus sessions, or generate visual media today?",
        isUser: false,
        timestamp: Date.now()
      }
    ];
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("life_os_chat_messages", JSON.stringify(messages));
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput("");
    setError(null);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      text: userText,
      isUser: true,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: userText,
          systemInstruction: "You are Deepa, the native AI core of Life OS. Be helpful, concise, and professional."
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned error ${response.status}`);
      }

      const data = await response.json();
      
      const botMessage: ChatMessage = {
        id: `bot-${Date.now()}`,
        text: data.text || "I processed your request, but received no text content.",
        isUser: false,
        base64Image: data.base64Image || null,
        modelUsed: data.modelUsed || "Gemini Core",
        timestamp: Date.now()
      };

      setMessages(prev => [...prev, botMessage]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to contact Deepa AI server.");
      const errorMessage: ChatMessage = {
        id: `err-${Date.now()}`,
        text: "Error: I'm currently unable to process requests. Please ensure your GEMINI_API_KEY is configured in Settings.",
        isUser: false,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    if (window.confirm("Are you sure you want to clear your chat history?")) {
      setMessages([
        {
          id: "welcome",
          text: "Hello! I am Deepa, your intelligent Life OS assistant. How can I help you organize your tasks, log your focus sessions, or generate visual media today?",
          isUser: false,
          timestamp: Date.now()
        }
      ]);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#04060f] border border-gray-900 rounded-2xl overflow-hidden shadow-2xl">
      {/* Top AI Header */}
      <div className="px-5 py-4 bg-gray-950/60 border-b border-gray-900 flex items-center justify-between select-none">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Sparkles className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
              Deepa AI Core
            </h2>
            <p className="text-[10px] font-mono text-gray-500">POWERED BY GEMINI 1.5 & 3.1 IMAGE</p>
          </div>
        </div>
        <button
          onClick={clearChat}
          className="text-[10px] font-mono text-gray-500 hover:text-red-400 border border-gray-850 hover:border-red-500/20 bg-gray-900/30 px-2.5 py-1 rounded-md transition-all cursor-pointer"
        >
          CLEAR CHAT
        </button>
      </div>

      {/* Messages viewport */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 max-w-3xl ${msg.isUser ? "ml-auto flex-row-reverse" : "mr-auto"}`}
          >
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border select-none
              ${msg.isUser 
                ? "bg-blue-600/10 border-blue-500/20 text-blue-400" 
                : "bg-gray-900/50 border-gray-800 text-gray-400"}`}
            >
              {msg.isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>

            {/* Content box */}
            <div className={`flex flex-col gap-1.5 ${msg.isUser ? "items-end" : "items-start"}`}>
              <div className={`px-4 py-3 rounded-2xl text-xs leading-relaxed max-w-full
                ${msg.isUser 
                  ? "bg-blue-600 text-white rounded-tr-none" 
                  : "bg-gray-900/40 border border-gray-850/80 text-gray-300 rounded-tl-none"}`}
              >
                <p className="whitespace-pre-wrap">{msg.text}</p>

                {msg.base64Image && (
                  <div className="mt-3.5 rounded-lg overflow-hidden border border-gray-800 bg-black/40">
                    <img 
                      src={`data:image/jpeg;base64,${msg.base64Image}`} 
                      alt="Generated" 
                      className="max-w-full max-h-80 object-contain mx-auto"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                )}
              </div>

              {msg.modelUsed && (
                <span className="text-[8px] font-mono text-gray-600 px-1 uppercase tracking-wider">
                  {msg.modelUsed}
                </span>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3 mr-auto animate-pulse">
            <div className="w-8 h-8 rounded-lg bg-gray-900/50 border border-gray-800 flex items-center justify-center text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
            <div className="px-4 py-3 bg-gray-900/40 border border-gray-850/80 rounded-2xl rounded-tl-none text-xs text-gray-500 flex items-center gap-2">
              <span>Deepa is generating a response...</span>
            </div>
          </div>
        )}
        {error && (
          <div className="p-3 bg-red-500/5 border border-red-500/10 text-red-400 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box */}
      <form onSubmit={handleSend} className="p-4 bg-gray-950/60 border-t border-gray-900 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Deepa AI or say 'generate image of a cybernetic garden'..."
          className="flex-1 bg-gray-900 border border-gray-850 focus:border-blue-500/50 text-xs px-4 rounded-xl outline-none text-white h-11 transition-all"
          disabled={isLoading}
        />
        <button
          type="submit"
          className="w-11 h-11 bg-blue-600 hover:bg-blue-500 text-white rounded-xl flex items-center justify-center transition-all cursor-pointer disabled:opacity-50"
          disabled={isLoading}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
