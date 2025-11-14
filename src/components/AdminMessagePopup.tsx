import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';

const BRAND_ORANGE = '#D14A2D';

interface AdminMessage {
  id: string;
  title: string;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const AdminMessagePopup: React.FC = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [seenMessageIds, setSeenMessageIds] = useState<string[]>([]);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [showPopup, setShowPopup] = useState(false);
  const [hasCheckedMessages, setHasCheckedMessages] = useState(false);
  const [hasShownPopup, setHasShownPopup] = useState(false);

  // Reset state when user changes
  useEffect(() => {
    setMessages([]);
    setSeenMessageIds([]);
    setCurrentMessageIndex(0);
    setShowPopup(false);
    setHasCheckedMessages(false);
    setHasShownPopup(false);
  }, [user?.id]);

  // Load active messages and seen message IDs
  useEffect(() => {
    if (!user?.id || hasCheckedMessages) {
      console.log('[AdminMessagePopup] Skipping load:', { userId: user?.id, hasCheckedMessages });
      return;
    }

    console.log('[AdminMessagePopup] Loading messages for user:', user?.id, 'role:', user?.role);

    const loadMessages = async () => {
      try {
        const token = localStorage.getItem('cognitive_dash_token');
        if (!token) {
          console.log('[AdminMessagePopup] No token found');
          return;
        }

        // Load active messages and seen message IDs in parallel
        const [messagesResp, seenResp] = await Promise.all([
          fetch(`${API_BASE_URL}/api/admin-messages/active`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }),
          fetch(`${API_BASE_URL}/api/admin-messages/seen`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          })
        ]);

        console.log('[AdminMessagePopup] API responses:', {
          messagesStatus: messagesResp.status,
          messagesOk: messagesResp.ok,
          seenStatus: seenResp.status,
          seenOk: seenResp.ok
        });

        // Handle messages response
        let messagesData = { messages: [] };
        if (messagesResp.ok) {
          try {
            messagesData = await messagesResp.json();
          } catch (e) {
            console.error('[AdminMessagePopup] Error parsing messages JSON:', e);
            const text = await messagesResp.text();
            console.error('[AdminMessagePopup] Messages response text:', text);
          }
        } else {
          const errorText = await messagesResp.text();
          console.error('[AdminMessagePopup] Messages API error:', {
            status: messagesResp.status,
            statusText: messagesResp.statusText,
            error: errorText
          });
        }

        // Handle seen response
        let seenData = { seenMessageIds: [] };
        if (seenResp.ok) {
          try {
            seenData = await seenResp.json();
          } catch (e) {
            console.error('[AdminMessagePopup] Error parsing seen JSON:', e);
            const text = await seenResp.text();
            console.error('[AdminMessagePopup] Seen response text:', text);
          }
        } else {
          let errorText = '';
          try {
            errorText = await seenResp.text();
          } catch (e) {
            errorText = 'Could not read error response';
          }
          console.error('[AdminMessagePopup] Seen API error:', {
            status: seenResp.status,
            statusText: seenResp.statusText,
            error: errorText,
            url: `${API_BASE_URL}/api/admin-messages/seen`
          });
        }

        // Only proceed if we got messages (seen can fail, that's okay - we'll treat all as unseen)
        if (messagesResp.ok) {
          console.log('[AdminMessagePopup] Raw data:', {
            messagesCount: messagesData.messages?.length || 0,
            seenCount: seenData.seenMessageIds?.length || 0,
            seenEndpointWorking: seenResp.ok
          });
          
          const activeMessages = (messagesData.messages || []).filter((msg: AdminMessage) => msg.isActive);
          // If seen endpoint failed, treat all messages as unseen (safer default)
          const seenIds = seenResp.ok ? (seenData.seenMessageIds || []) : [];
          
          console.log('[AdminMessagePopup] Filtered data:', {
            activeMessagesCount: activeMessages.length,
            seenIdsCount: seenIds.length,
            activeMessages: activeMessages.map(m => ({ id: m.id, title: m.title, isActive: m.isActive }))
          });
          
          setMessages(activeMessages);
          setSeenMessageIds(seenIds);
          
          // Check localStorage for locally marked seen messages (fallback if backend fails)
          const localStorageKey = `adminMessages_seen_${user?.id}`;
          let localSeenIds: string[] = [];
          try {
            const localSeen = localStorage.getItem(localStorageKey);
            if (localSeen) {
              localSeenIds = JSON.parse(localSeen);
            }
          } catch (e) {
            console.error('[AdminMessagePopup] Error reading localStorage:', e);
          }
          
          // Combine backend seen IDs with local seen IDs
          const allSeenIds = [...new Set([...seenIds, ...localSeenIds])];
          setSeenMessageIds(allSeenIds);
          
          // Check if there are unseen messages
          if (activeMessages.length > 0) {
            const unseenMessages = activeMessages.filter((msg: AdminMessage) => !allSeenIds.includes(msg.id));
            console.log('[AdminMessagePopup] Unseen messages:', unseenMessages.length, 'Total seen:', allSeenIds.length);
            
            if (unseenMessages.length > 0 && !hasShownPopup) {
              // There are unseen messages - show popup
              console.log('[AdminMessagePopup] Showing popup with', unseenMessages.length, 'unseen messages');
              setShowPopup(true);
              setHasShownPopup(true);
              // Find the first unseen message index
              const firstUnseenIndex = activeMessages.findIndex((msg: AdminMessage) => !allSeenIds.includes(msg.id));
              setCurrentMessageIndex(firstUnseenIndex >= 0 ? firstUnseenIndex : 0);
            } else {
              // All messages are seen or popup already shown - don't show popup
              console.log('[AdminMessagePopup] Not showing popup - all seen or already shown');
              setHasShownPopup(true);
            }
          } else {
            console.log('[AdminMessagePopup] No active messages found');
          }
        } else {
          console.error('[AdminMessagePopup] Both API calls failed');
        }

        setHasCheckedMessages(true);
      } catch (error) {
        console.error('[AdminMessagePopup] Error loading admin messages:', error);
        setHasCheckedMessages(true);
      }
    };

    loadMessages();
  }, [user?.id, hasCheckedMessages, user?.role]);

  const markMessageAsSeen = async (messageId: string) => {
    try {
      const token = localStorage.getItem('cognitive_dash_token');
      if (!token) return;

      await fetch(`${API_BASE_URL}/api/admin-messages/${messageId}/mark-seen`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      setSeenMessageIds(prev => [...prev, messageId]);
    } catch (error) {
      console.error('Error marking message as seen:', error);
    }
  };

  const handleClose = async () => {
    // Mark all unseen messages as seen when closing the popup
    const unseenMessages = messages.filter(msg => !seenMessageIds.includes(msg.id));
    
    // Update local state immediately so popup doesn't show again
    const newSeenIds = [...seenMessageIds, ...unseenMessages.map(m => m.id)];
    setSeenMessageIds(newSeenIds);
    setShowPopup(false);
    setHasShownPopup(true);
    
    // Save to localStorage as backup (persists across page navigations)
    if (user?.id) {
      const localStorageKey = `adminMessages_seen_${user.id}`;
      try {
        localStorage.setItem(localStorageKey, JSON.stringify(newSeenIds));
      } catch (e) {
        console.error('[AdminMessagePopup] Error saving to localStorage:', e);
      }
    }
    
    // Then mark as seen on backend (fire and forget - we've already updated local state)
    for (const message of unseenMessages) {
      markMessageAsSeen(message.id).catch(err => {
        console.error('[AdminMessagePopup] Failed to mark message as seen on backend:', err);
      });
    }
  };

  const handleNext = () => {
    if (messages.length > 0 && currentMessageIndex < messages.length) {
      // Just navigate to the next message without marking as seen
      if (currentMessageIndex < messages.length - 1) {
        setCurrentMessageIndex(prev => prev + 1);
      } else {
        // If we're on the last message, close the popup and mark all as seen
        handleClose();
      }
    }
  };

  if (!showPopup || messages.length === 0) {
    return null;
  }

  const currentMessage = messages[currentMessageIndex];
  const unseenCount = messages.filter(msg => !seenMessageIds.includes(msg.id)).length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000] p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 rounded-t-lg" style={{ backgroundColor: BRAND_ORANGE }}>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <h4 className="text-lg font-semibold text-white truncate">{currentMessage.title}</h4>
            {unseenCount > 1 && (
              <span className="px-2 py-0.5 text-xs bg-white bg-opacity-20 text-white rounded-full flex-shrink-0">
                {unseenCount} messages
              </span>
            )}
          </div>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          <div className="text-gray-700 whitespace-pre-wrap leading-relaxed">
            {currentMessage.content}
          </div>
        </div>
        <div className="flex items-center justify-between p-4 border-t border-gray-200">
          <div className="flex items-center">
            <img
              src="/CogDashLogo.png"
              alt="Cognitive Dash Logo"
              className="h-8 w-auto object-contain"
            />
          </div>
          <div className="flex items-center gap-3">
            {currentMessageIndex < messages.length - 1 && (
              <button
                onClick={handleNext}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Next
              </button>
            )}
            <button
              onClick={handleClose}
              className="px-4 py-2 text-white rounded-lg transition-colors"
              style={{ backgroundColor: BRAND_ORANGE }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#B74227';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = BRAND_ORANGE;
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminMessagePopup;

