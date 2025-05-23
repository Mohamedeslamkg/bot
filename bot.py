import discord
import os
import google.generativeai as genai
from collections import deque # Import deque for efficient history management

try:
    import config
except FileNotFoundError:
    config = None

DISCORD_TOKEN = getattr(config, 'DISCORD_TOKEN', os.getenv('DISCORD_TOKEN'))
GEMINI_API_KEY = getattr(config, 'GEMINI_API_KEY', os.getenv('GEMINI_API_KEY'))
# Load max history, default to 10 if not set in config or env
MAX_HISTORY_MESSAGES = int(getattr(config, 'MAX_HISTORY_MESSAGES', os.getenv('MAX_HISTORY_MESSAGES', 10)))

# Load Personalities Configuration
AVAILABLE_PERSONALITIES = getattr(config, 'AVAILABLE_PERSONALITIES', {
    "default": "You are a helpful AI assistant."
})
DEFAULT_PERSONALITY = getattr(config, 'DEFAULT_PERSONALITY', "default")
if DEFAULT_PERSONALITY not in AVAILABLE_PERSONALITIES:
    # Fallback if default is misconfigured
    DEFAULT_PERSONALITY = next(iter(AVAILABLE_PERSONALITIES)) 

# Global store for user-selected personalities (user_id: personality_key)
user_personalities = {}

if not DISCORD_TOKEN:
    print("Error: DISCORD_TOKEN not found. Please set it in config.py or as an environment variable.")
    exit()
if not GEMINI_API_KEY:
    print("Error: GEMINI_API_KEY not found. Please set it in config.py or as an environment variable.")
    exit()

genai.configure(api_key=GEMINI_API_KEY)
# For chat history, it's better to start a chat session
gemini_model = genai.GenerativeModel('gemini-pro') # Initialize the model for chat

# Global store for conversation histories (user_id: deque of messages)
conversation_histories = {}
# Note: user_personalities is initialized above, after loading personality configs.

# Set up Discord Client
intents = discord.Intents.default()
intents.messages = True  # Enable message events
intents.message_content = True # Ensure message content intent is enabled
client = discord.Client(intents=intents)

def get_user_personality_prompt(user_id_str):
    personality_key = user_personalities.get(user_id_str, DEFAULT_PERSONALITY)
    # Ensure the key actually exists, fallback to default if it was somehow invalidly set
    if personality_key not in AVAILABLE_PERSONALITIES:
        personality_key = DEFAULT_PERSONALITY
    return AVAILABLE_PERSONALITIES[personality_key]

@client.event
async def on_ready():
    print(f'We have logged in as {client.user}')

@client.event
async def on_message(message):
    if message.author == client.user:
        return

    user_id = str(message.author.id)
    user_message_content_lower = message.content.lower() # For command checking

    # Personality Commands
    if user_message_content_lower.startswith("!setpersonality"):
        parts = message.content.split() # Use original content for case-sensitive personality name if needed
        if len(parts) > 1:
            new_personality_key = parts[1].lower() # Store keys in lowercase
            if new_personality_key in AVAILABLE_PERSONALITIES:
                user_personalities[user_id] = new_personality_key
                if user_id in conversation_histories: # Clear history for the new personality
                    conversation_histories[user_id].clear()
                await message.channel.send(f"Personality set to: **{new_personality_key}**. Your conversation history for this session has been cleared.")
            else:
                await message.channel.send(f"Unknown personality. Available: {', '.join(AVAILABLE_PERSONALITIES.keys())}")
        else:
            await message.channel.send("Usage: `!setpersonality <name>`. Available: " + ", ".join(AVAILABLE_PERSONALITIES.keys()))
        return

    if user_message_content_lower == "!getpersonality":
        current_personality_key = user_personalities.get(user_id, DEFAULT_PERSONALITY)
        # Ensure the key is valid before trying to access its description
        if current_personality_key not in AVAILABLE_PERSONALITIES:
            current_personality_key = DEFAULT_PERSONALITY # Fallback
        personality_description = AVAILABLE_PERSONALITIES.get(current_personality_key, "Unknown personality description.")
        await message.channel.send(f"Your current personality is: **{current_personality_key}** - \"{personality_description[:100]}...\"")
        return

    if user_message_content_lower == "!listpersonalities":
        p_list = "\n".join([f"- **{key}**: \"{AVAILABLE_PERSONALITIES[key][:70]}...\"" for key in AVAILABLE_PERSONALITIES.keys()])
        await message.channel.send(f"Available personalities:\n{p_list}")
        return

    # Existing !clearhistory command
    if user_message_content_lower == "!clearhistory":
        if user_id in conversation_histories:
            conversation_histories[user_id].clear()
            await message.channel.send("Your conversation history with me has been cleared (current personality remains).")
        else:
            await message.channel.send("You don't have any conversation history with me yet.")
        return

    # AI interaction command
    command_prefix = "!ai "
    # Use original message.content for query to preserve case for the AI
    if message.content.startswith(command_prefix):
        user_query_text = message.content[len(command_prefix):].strip()
        
        if not user_query_text:
            await message.channel.send("Please provide a query after `!ai `.")
            return

        # Retrieve history and personality
        user_conversation_deque = conversation_histories.setdefault(user_id, deque(maxlen=MAX_HISTORY_MESSAGES))
        current_system_prompt_text = get_user_personality_prompt(user_id)
        
        # Add user's current message to their history deque
        user_conversation_deque.append({"role": "user", "parts": [{"text": user_query_text}]})
        
        # Construct initial system messages for Gemini context
        initial_system_messages_for_gemini = [
            {"role": "user", "parts": [{"text": current_system_prompt_text}]},
            {"role": "model", "parts": [{"text": "Okay, I understand. I will act as described and follow this persona."}]}
        ]
        
        # The history for start_chat should include the system prompt, then the actual turns, *excluding the last user query*.
        # The last user query is then sent via send_message.
        chat_session_history_turns = list(user_conversation_deque) # This is what we've been storing
        current_turn_user_query_content = chat_session_history_turns[-1] # This is {"role":"user", "parts":...}
        
        # History for model initialization: system prompt + conversation history up to (but not including) the current user query
        history_for_model_init = initial_system_messages_for_gemini + chat_session_history_turns[:-1]

        active_personality_key = user_personalities.get(user_id, DEFAULT_PERSONALITY)
        print(f"Query from {message.author} (Personality: {active_personality_key}). History for model init length: {len(history_for_model_init)}")

        try:
            chat = gemini_model.start_chat(history=history_for_model_init)
            # Send only the parts of the user's current message
            response = await chat.send_message_async(current_turn_user_query_content['parts'])

            ai_response_text = response.text if hasattr(response, 'text') else "".join(p.text for p in response.parts if hasattr(p, 'text'))
            
            if not ai_response_text.strip():
                ai_response_text = "I received an empty or non-text response from the AI."
            
            # Add bot's response to history deque
            user_conversation_deque.append({"role": "model", "parts": [{"text": ai_response_text}]})
            
            print(f"Sending response... (first 200 chars: {ai_response_text[:200]})")
            
            if len(ai_response_text) > 2000:
                await message.channel.send(ai_response_text[:2000] + "...")
            else:
                await message.channel.send(ai_response_text)

        except Exception as e:
            print(f"Error processing query for {message.author} (ID: {user_id}): {e}")
            # Rollback the user's last message from deque if error
            if user_conversation_deque and user_conversation_deque[-1]["role"] == "user":
                user_conversation_deque.pop()
            await message.channel.send(f"Sorry, I encountered an error processing that: {e}")
    # else:
        # Optional: Handle messages not starting with !ai (e.g., ignore, or log)
        # print(f"Message from {message.author} (ID: {user_id}) did not trigger AI: {message.content}")

if __name__ == '__main__':
    client.run(DISCORD_TOKEN)
