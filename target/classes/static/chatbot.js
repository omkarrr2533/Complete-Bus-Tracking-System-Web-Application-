// CityBus Chatbot - Intelligent Assistant for Bus Tracking
class CityBusChatbot {
    constructor() {
        this.isOpen = false;
        this.conversationHistory = [];
        this.currentContext = null;
        this.init();
    }

    init() {
        this.createChatbotElements();
        this.setupEventListeners();
        this.showWelcomeMessage();
        this.loadConversationHistory();
    }

    createChatbotElements() {
        // Elements are already in HTML, just initialize them
        this.toggleBtn = document.getElementById('chatbot-toggle');
        this.container = document.getElementById('chatbot-container');
        this.messagesContainer = document.getElementById('chatbot-messages');
        this.input = document.getElementById('chatbot-input');
        this.sendBtn = document.getElementById('chatbot-send');
        this.closeBtn = document.getElementById('chatbot-close');
        this.quickActions = document.getElementById('quick-actions');
    }

    setupEventListeners() {
        // Toggle chatbot
        this.toggleBtn.addEventListener('click', () => this.toggleChatbot());
        this.closeBtn.addEventListener('click', () => this.closeChatbot());

        // Send message on button click
        this.sendBtn.addEventListener('click', () => this.sendMessage());

        // Send message on Enter key
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        // Quick action buttons
        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.getAttribute('data-action');
                this.handleQuickAction(action);
            });
        });

        // Close chatbot when clicking outside
        document.addEventListener('click', (e) => {
            if (this.isOpen && !this.container.contains(e.target) && !this.toggleBtn.contains(e.target)) {
                this.closeChatbot();
            }
        });

        // Input focus effects
        this.input.addEventListener('focus', () => {
            this.container.classList.add('input-focused');
        });

        this.input.addEventListener('blur', () => {
            this.container.classList.remove('input-focused');
        });
    }

    toggleChatbot() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.openChatbot();
        } else {
            this.closeChatbot();
        }
    }

    openChatbot() {
        this.container.style.display = 'block';
        this.container.classList.add('open');
        this.toggleBtn.classList.add('active');

        // Focus input after animation
        setTimeout(() => {
            this.input.focus();
            this.scrollToBottom();
        }, 300);

        // Hide notification dot
        document.querySelector('.notification-dot').style.display = 'none';
    }

    closeChatbot() {
        this.container.classList.remove('open');
        this.toggleBtn.classList.remove('active');

        setTimeout(() => {
            this.container.style.display = 'none';
        }, 300);
        this.isOpen = false;
    }

    showWelcomeMessage() {
        const welcomeMessage = {
            type: 'bot',
            content: `Hello! I'm your CityBus Assistant 🚌\n\nI can help you with:\n• Real-time bus tracking\n• Route information\n• Schedule details\n• Stop locations\n• Trip planning\n\nHow can I assist you today?`,
            timestamp: new Date()
        };

        this.addMessage(welcomeMessage);
    }

    async sendMessage() {
        const message = this.input.value.trim();
        if (!message) return;

        // Add user message
        this.addMessage({
            type: 'user',
            content: message,
            timestamp: new Date()
        });

        // Clear input
        this.input.value = '';

        // Show typing indicator
        this.showTypingIndicator();

        // Process message and get response
        try {
            const response = await this.processMessage(message);

            // Remove typing indicator
            this.hideTypingIndicator();

            // Add bot response
            setTimeout(() => {
                this.addMessage({
                    type: 'bot',
                    content: response,
                    timestamp: new Date()
                });
            }, 500);

        } catch (error) {
            this.hideTypingIndicator();
            this.addMessage({
                type: 'bot',
                content: "I apologize, but I'm having trouble processing your request. Please try again.",
                timestamp: new Date()
            });
        }
    }

    showTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message bot-message typing-indicator';
        typingDiv.innerHTML = `
            <div class="message-content">
                <div class="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
        this.messagesContainer.appendChild(typingDiv);
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        const typingIndicator = this.messagesContainer.querySelector('.typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    async processMessage(message) {
        // Convert to lowercase for easier matching
        const lowerMessage = message.toLowerCase();

        // Save to conversation history
        this.conversationHistory.push({ role: 'user', content: message });

        // Analyze intent and generate response
        let response = await this.analyzeIntent(lowerMessage, message);

        // Save bot response to history
        this.conversationHistory.push({ role: 'assistant', content: response });

        // Save to localStorage
        this.saveConversationHistory();

        return response;
    }

    async analyzeIntent(lowerMessage, originalMessage) {
        // Intent detection
        if (lowerMessage.includes('track') || lowerMessage.includes('where') || lowerMessage.includes('location')) {
            return this.handleTrackingQuery(lowerMessage, originalMessage);
        }
        else if (lowerMessage.includes('route') || lowerMessage.includes('how to get') || lowerMessage.includes('way to')) {
            return this.handleRouteQuery(lowerMessage, originalMessage);
        }
        else if (lowerMessage.includes('schedule') || lowerMessage.includes('time') || lowerMessage.includes('when')) {
            return this.handleScheduleQuery(lowerMessage, originalMessage);
        }
        else if (lowerMessage.includes('stop') || lowerMessage.includes('station') || lowerMessage.includes('stand')) {
            return this.handleStopQuery(lowerMessage, originalMessage);
        }
        else if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey')) {
            return "Hello! 👋 I'm here to help you with all your bus-related questions. What would you like to know?";
        }
        else if (lowerMessage.includes('thank') || lowerMessage.includes('thanks')) {
            return "You're welcome! 😊 Is there anything else I can help you with?";
        }
        else if (lowerMessage.includes('help') || lowerMessage.includes('what can you do')) {
            return this.getHelpResponse();
        }
        else {
            return this.handleGeneralQuery(originalMessage);
        }
    }

    handleTrackingQuery(message, originalMessage) {
        // Extract bus number from message
        const busMatch = originalMessage.match(/(bus|bus-)?(\d+)/i);
        const busNumber = busMatch ? busMatch[2] || busMatch[1] : null;

        if (busNumber) {
            // Simulate real-time tracking data
            const buses = {
                '1': { location: "Near Alphonsa Stop", nextStop: "Pratap Chowk", eta: "3 min", distance: "1.2 km" },
                '2': { location: "At Railway Station", nextStop: "Paithan Road", eta: "7 min", distance: "2.8 km" },
                '3': { location: "Approaching City Center", nextStop: "Medical College", eta: "5 min", distance: "1.8 km" },
                '4': { location: "At MIDC Road", nextStop: "Gollwadi Chowk", eta: "2 min", distance: "0.8 km" },
                '5': { location: "Near Fame Signal", nextStop: "N1 Ganpati", eta: "4 min", distance: "1.5 km" }
            };

            const busInfo = buses[busNumber];
            if (busInfo) {
                return `🚌 **Bus ${busNumber} Tracking Info:**\n\n📍 **Current Location:** ${busInfo.location}\n⏭️ **Next Stop:** ${busInfo.nextStop}\n⏱️ **ETA to Next Stop:** ${busInfo.eta}\n📏 **Distance:** ${busInfo.distance}\n\n💡 *Tip: Click "Track Bus" above to see it on the map!*`;
            }
        }

        return `I can help you track buses! Please specify which bus you're looking for. For example:\n\n• "Where is bus 1?"\n• "Track bus 3"\n• "Bus 2 location"\n\nAvailable buses: 1, 2, 3, 4, 5`;
    }

    handleRouteQuery(message, originalMessage) {
        const routes = {
            '1': {
                name: "Ranjangaon Phata Route",
                stops: ["Ranjangaon Phata", "Alphonsa", "Pratap Chowk", "MIDC Road", "Gollwadi Chowk", "CSMSS"],
                duration: "45 minutes",
                frequency: "Every 15 minutes"
            },
            '2': {
                name: "Fame Tapadia Signal Route",
                stops: ["Fame Signal", "N1 Ganpati", "Wokhardt", "Railway Station", "Paithan Road", "CSMSS"],
                duration: "55 minutes",
                frequency: "Every 20 minutes"
            }
        };

        if (message.includes('1') || message.includes('ranjangaon')) {
            const route = routes['1'];
            return `🟥 **Route 1: ${route.name}**\n\n🚏 **Stops:** ${route.stops.join(' → ')}\n⏱️ **Duration:** ${route.duration}\n🔄 **Frequency:** ${route.frequency}\n\n📍 *Total stops: ${route.stops.length}*`;
        }
        else if (message.includes('2') || message.includes('fame') || message.includes('tapadia')) {
            const route = routes['2'];
            return `🟦 **Route 2: ${route.name}**\n\n🚏 **Stops:** ${route.stops.join(' → ')}\n⏱️ **Duration:** ${route.duration}\n🔄 **Frequency:** ${route.frequency}\n\n📍 *Total stops: ${route.stops.length}*`;
        }

        return `I can provide route information! Which route are you interested in?\n\n• **Route 1:** Ranjangaon Phata\n• **Route 2:** Fame Tapadia Signal\n\nTry asking: "Tell me about route 1" or "What's the route 2 schedule?"`;
    }

    handleScheduleQuery(message, originalMessage) {
        const schedules = {
            'weekday': {
                '1': "6:00 AM - 10:00 PM (Every 15 min)",
                '2': "5:30 AM - 10:30 PM (Every 20 min)"
            },
            'weekend': {
                '1': "6:30 AM - 9:30 PM (Every 20 min)",
                '2': "6:00 AM - 10:00 PM (Every 25 min)"
            }
        };

        if (message.includes('1')) {
            return `📅 **Route 1 Schedule:**\n\n**Weekdays:** ${schedules.weekday['1']}\n**Weekends:** ${schedules.weekend['1']}\n\n⏰ *First bus: 6:00 AM | Last bus: 10:00 PM*`;
        }
        else if (message.includes('2')) {
            return `📅 **Route 2 Schedule:**\n\n**Weekdays:** ${schedules.weekday['2']}\n**Weekends:** ${schedules.weekend['2']}\n\n⏰ *First bus: 5:30 AM | Last bus: 10:30 PM*`;
        }

        return `Here are the general bus schedules:\n\n**Route 1 (Ranjangaon Phata):**\n• Weekdays: 6:00 AM - 10:00 PM\n• Weekends: 6:30 AM - 9:30 PM\n\n**Route 2 (Fame Tapadia):**\n• Weekdays: 5:30 AM - 10:30 PM\n• Weekends: 6:00 AM - 10:00 PM\n\nAsk about a specific route for more details!`;
    }

    handleStopQuery(message, originalMessage) {
        const stops = {
            'railway': { routes: [1, 2], location: "Station Road", facilities: ["Ticket Counter", "Waiting Area", "Restrooms"] },
            'city center': { routes: [1], location: "Main Square", facilities: ["Shopping Mall", "Food Court"] },
            'medical college': { routes: [1], location: "College Road", facilities: ["Hospital", "Pharmacy"] },
            'fame signal': { routes: [2], location: "Tapadia Road", facilities: ["Signal", "Commercial Area"] }
        };

        for (const [stopName, info] of Object.entries(stops)) {
            if (message.includes(stopName)) {
                return `📍 **${stopName.toUpperCase()} Bus Stop**\n\n🚌 **Routes:** ${info.routes.join(', ')}\n📌 **Location:** ${info.location}\n🏪 **Facilities:** ${info.facilities.join(', ')}\n\nℹ️ *Serves ${info.routes.length} route(s)*`;
            }
        }

        return `I have information about these major stops:\n\n• Railway Station\n• City Center\n• Medical College\n• Fame Signal\n\nWhich stop are you interested in?`;
    }

    handleGeneralQuery(message) {
        // For unknown queries, provide helpful suggestions
        return `I'm not sure I understand. Here's what I can help you with:\n\n🚌 **Bus Tracking** - "Where is bus 1?"\n🗺️ **Route Info** - "Tell me about route 2"\n⏰ **Schedules** - "What's the schedule for route 1?"\n📍 **Stop Info** - "Information about railway station"\n\nTry rephrasing your question or use the quick buttons above!`;
    }

    getHelpResponse() {
        return `**CityBus Assistant Help Guide** 🚌\n\nI can help you with:\n\n🔍 **Real-time Tracking**\n• "Where is bus 3?"\n• "Track bus 1 location"\n\n🗺️ **Route Information**\n• "Route 1 details"\n• "Show me route 2 stops"\n\n⏰ **Schedule & Timing**\n• "Route 1 schedule"\n• "When does the last bus run?"\n\n📍 **Stop Information**\n• "Railway station bus stop"\n• "Facilities at city center"\n\n💡 **Quick Tips:**\n• Use specific bus numbers (1-5)\n• Mention route numbers (1 or 2)\n• Ask about specific locations\n\nWhat would you like to know?`;
    }

    handleQuickAction(action) {
        const actions = {
            'track-bus': "I can help you track buses! Which bus are you looking for? Try: 'Where is bus 1?' or 'Track bus 3'",
            'find-route': "I have information about Route 1 (Ranjangaon Phata) and Route 2 (Fame Tapadia). Which route would you like to know about?",
            'schedule': "I can tell you about bus schedules! Are you interested in Route 1 or Route 2 schedule?"
        };

        this.addMessage({
            type: 'user',
            content: this.getQuickActionPrompt(action),
            timestamp: new Date()
        });

        this.showTypingIndicator();

        setTimeout(() => {
            this.hideTypingIndicator();
            this.addMessage({
                type: 'bot',
                content: actions[action],
                timestamp: new Date()
            });
        }, 800);
    }

    getQuickActionPrompt(action) {
        const prompts = {
            'track-bus': "I want to track a bus",
            'find-route': "Show me route information",
            'schedule': "Check bus schedule"
        };
        return prompts[action];
    }

    addMessage(messageData) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${messageData.type}-message`;

        const timeString = messageData.timestamp.toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit'
        });

        messageElement.innerHTML = `
            <div class="message-content">
                <div class="message-text">${this.formatMessage(messageData.content)}</div>
                <div class="message-time">${timeString}</div>
            </div>
        `;

        this.messagesContainer.appendChild(messageElement);
        this.scrollToBottom();

        // Add to conversation history
        this.conversationHistory.push(messageData);
    }

    formatMessage(content) {
        // Convert line breaks and basic formatting
        return content.replace(/\n/g, '<br>')
                     .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                     .replace(/\*(.*?)\*/g, '<em>$1</em>');
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    saveConversationHistory() {
        try {
            localStorage.setItem('citybus_chat_history', JSON.stringify(this.conversationHistory));
        } catch (e) {
            console.warn('Could not save chat history:', e);
        }
    }

    loadConversationHistory() {
        try {
            const saved = localStorage.getItem('citybus_chat_history');
            if (saved) {
                this.conversationHistory = JSON.parse(saved);

                // Only keep last 10 messages to avoid clutter
                if (this.conversationHistory.length > 10) {
                    this.conversationHistory = this.conversationHistory.slice(-10);
                }
            }
        } catch (e) {
            console.warn('Could not load chat history:', e);
        }
    }

    // Method to integrate with existing bus tracking
    trackBusOnMap(busId) {
        if (typeof trackBus === 'function') {
            trackBus(`bus-${busId}`, '1'); // Default to route 1
        }

        // Switch to tracking page if available
        if (typeof switchToPage === 'function') {
            switchToPage('tracking');
        }

        this.closeChatbot();
    }
}

// Initialize chatbot when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.citybusChatbot = new CityBusChatbot();

    // Add chatbot to global functions for integration
    window.openChatbot = () => window.citybusChatbot.openChatbot();
    window.askChatbot = (question) => {
        window.citybusChatbot.openChatbot();
        setTimeout(() => {
            document.getElementById('chatbot-input').value = question;
            window.citybusChatbot.sendMessage();
        }, 500);
    };
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CityBusChatbot;
}