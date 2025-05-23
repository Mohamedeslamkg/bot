import discord
import os
import google.generativeai as genai

# Attempt to import config, but handle FileNotFoundError gracefully for environments where it might not be present initially
try:
    import config
except FileNotFoundError:
    config = None # Or define default/placeholder values if appropriate

# Load token and key from config.py if available, otherwise try environment variables
DISCORD_TOKEN = getattr(config, 'DISCORD_TOKEN', os.getenv('DISCORD_TOKEN'))
GEMINI_API_KEY = getattr(config, 'GEMINI_API_KEY', os.getenv('GEMINI_API_KEY'))

if not DISCORD_TOKEN:
    print("Error: DISCORD_TOKEN not found. Please set it in config.py or as an environment variable.")
    exit()
if not GEMINI_API_KEY:
    print("Error: GEMINI_API_KEY not found. Please set it in config.py or as an environment variable.")
    exit()

# Configure Gemini API
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-pro') # Or another suitable model

# Set up Discord Client
intents = discord.Intents.default()
intents.messages = True  # Enable message events
intents.message_content = True # Ensure message content intent is enabled
client = discord.Client(intents=intents)

@client.event
async def on_ready():
    print(f'We have logged in as {client.user}')

@client.event
async def on_message(message):
    if message.author == client.user:
        return

    command_prefix = "!ai "
    if message.content.startswith(command_prefix):
        user_query = message.content[len(command_prefix):].strip()
        
        if not user_query:
            await message.channel.send("Please provide a query after `!ai `.")
            return

        print(f"Received query from {message.author}: {user_query}")

        try:
            # Send query to Gemini
            response = model.generate_content(user_query)
            
            # Make sure to access the text part of the response correctly.
            # This might vary slightly depending on the Gemini API version and response structure.
            # Common ways: response.text or iterating response.parts
            ai_response = ""
            if hasattr(response, 'text'):
                ai_response = response.text
            else: # Fallback for cases where response.parts is used
                for part in response.parts:
                    if hasattr(part, 'text'):
                        ai_response += part.text
                    else: # If parts don't have text, log it or handle as error
                        print(f"Unexpected part structure: {part}")
            
            if not ai_response.strip():
                ai_response = "I received an empty response from the AI."
                
            print(f"Sending response to {message.author}: {ai_response[:200]}...") # Log snippet
            
            # Handle Discord message length limit (2000 characters)
            if len(ai_response) > 2000:
                await message.channel.send(ai_response[:2000] + "...")
                # Optionally, send more parts if the response is very long
            else:
                await message.channel.send(ai_response)

        except Exception as e:
            print(f"Error processing query for {message.author}: {e}")
            await message.channel.send(f"Sorry, I encountered an error trying to respond: {e}")

if __name__ == '__main__':
    client.run(DISCORD_TOKEN)
