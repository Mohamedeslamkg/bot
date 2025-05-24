const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const { token } = require('./config.json');

// Create a new client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Command handler
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = require(filePath);
	// Set a new item in the Collection with the key as the command name and the value as the exported module
	if ('data' in command && 'execute' in command) {
		client.commands.set(command.data.name, command);
	} else {
		console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
	}
}

// Event listener for interactions (slash commands and buttons)
client.on(Events.InteractionCreate, async interaction => {
	if (interaction.isChatInputCommand()) {
		const command = interaction.client.commands.get(interaction.commandName);

		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}

		try {
			await command.execute(interaction);
		} catch (error) {
			console.error('Error executing command:', error);
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
			} else {
				await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
			}
		}
	} else if (interaction.isButton()) {
		const customId = interaction.customId;
		const userId = interaction.user.id;
		console.log(`Button clicked: ${customId} by ${userId}`);

		// Delegate to a specific handler if the customId matches a pattern
		if (customId.startsWith('explore_')) {
			// Later, this will be a more sophisticated handler imported from another file
			// For now, basic logic for explore_attack and explore_flee
			const { handleExploreButton } = require('./commands/explore.js'); // Assuming explore.js will export this
			if (handleExploreButton) {
				try {
					await handleExploreButton(interaction);
				} catch (error) {
					console.error('Error handling explore button interaction:', error);
					// Ensure the user gets some feedback if the handler fails
					if (!interaction.replied && !interaction.deferred) {
						await interaction.reply({ content: 'There was an error processing this action.', ephemeral: true });
					} else {
						// If already deferred, try to followUp or editReply
						// await interaction.followUp({ content: 'There was an error processing this action.', ephemeral: true });
					}
				}
			} else {
				console.error(`handleExploreButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Button action cannot be processed at this time.', ephemeral: true });
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: 'Button action cannot be processed at this time.', components: []});
                }
			}

		} else if (customId.startsWith('quest_')) {
            const { handleQuestButton } = require('./commands/quests.js'); // Assuming quests.js exports this
            if (handleQuestButton) {
                try {
                    await handleQuestButton(interaction);
                } catch (error) {
                    console.error('Error handling quest button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error processing this quest action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied) { // Check if deferred but not yet replied
                         try {
                            await interaction.editReply({ content: 'There was an error processing this quest action.', components: [] });
                         } catch (e) { console.error("Failed to editReply on quest button error", e); }
                    } else if (interaction.replied) {
                        // If already replied (e.g. by deferUpdate then an immediate error), try to followUp
                        // await interaction.followUp({ content: 'There was an error processing this quest action.', ephemeral: true });
                    }
                }
            } else {
                console.error(`handleQuestButton not found in quests.js`);
                 if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Quest button action cannot be processed at this time.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Quest button action cannot be processed at this time.', components: []});
                }
            }
        } else if (customId.startsWith('gather_node_')) {
            const { handleGatherButton } = require('./commands/gather.js');
            if (handleGatherButton) {
                try {
                    await handleGatherButton(interaction);
                } catch (error) {
                    console.error('Error handling gather button interaction:', error);
                    // Ensure user gets feedback
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error processing this gathering action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied) {
                        try { await interaction.editReply({ content: 'There was an error processing this gathering action.', components: [] }); }
                        catch (e) { console.error("Failed to editReply on gather button error", e); }
                    }
                }
            } else {
                console.error(`handleGatherButton not found in gather.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Gathering action cannot be processed at this time.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Gathering action cannot be processed at this time.', components: []});
                }
            }
        } else if (customId.startsWith('craft_item_')) {
            const { handleCraftButton } = require('./commands/craft.js');
            if (handleCraftButton) {
                try {
                    await handleCraftButton(interaction);
                } catch (error) {
                    console.error('Error handling craft button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error processing this crafting action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied) {
                        try { await interaction.editReply({ content: 'There was an error processing this crafting action.', components: [] }); }
                        catch (e) { console.error("Failed to editReply on craft button error", e); }
                    }
                }
            } else {
                console.error(`handleCraftButton not found in craft.js`);
                 if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Crafting action cannot be processed at this time.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Crafting action cannot be processed at this time.', components: []});
                }
            }
        } else if (customId.startsWith('party_accept_invite_') || customId.startsWith('party_decline_invite_')) {
            const { handlePartyInviteButton } = require('./commands/party.js');
            if (handlePartyInviteButton) {
                try {
                    await handlePartyInviteButton(interaction);
                } catch (error) {
                    console.error('Error handling party invite button interaction:', error);
                    // Attempt to inform the user about the error
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error processing this party invitation action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try { await interaction.editReply({ content: 'There was an error processing this party invitation action.', components:[]}); }
                         catch(e){ console.error("Failed to editReply on party invite button error", e); }
                    } else {
                        // If already replied, maybe followUp, but be careful with ephemeral nature of original reply
                        // await interaction.followUp({ content: 'There was an error processing this party invitation action.', ephemeral: true });
                    }
                }
            } else {
                console.error(`handlePartyInviteButton not found in party.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Party invitation action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Party invitation action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); // Assuming boss logic will be in explore.js or a new battleManager.js
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found (expected in explore.js or battleManager.js)`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); // Assuming boss logic will be in explore.js or a new battleManager.js
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found (expected in explore.js or battleManager.js)`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); // Assuming boss logic will be in explore.js or a new battleManager.js
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found (expected in explore.js or battleManager.js)`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else if (customId.startsWith('bossbattle_')) {
            const { handleBossBattleButton } = require('./commands/explore.js'); 
            if (handleBossBattleButton) {
                try {
                    await handleBossBattleButton(interaction);
                } catch (error) {
                    console.error('Error handling boss battle button interaction:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'There was an error during the boss battle action.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied){
                         try{ await interaction.editReply({ content: 'There was an error during the boss battle action.', components:[]}); }
                         catch(e) { console.error("Failed to editReply on boss battle button error", e); }
                    }
                }
            } else {
                console.error(`handleBossBattleButton not found in explore.js`);
                if (!interaction.replied && !interaction.deferred) {
				    await interaction.reply({ content: 'Boss battle action cannot be processed.', ephemeral: true });
                } else if (interaction.deferred) {
                     await interaction.editReply({ content: 'Boss battle action cannot be processed.', components: []});
                }
            }
        } else {
			console.log(`Unknown button customId: ${customId}`);
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({ content: 'This button is not recognized or has expired.', ephemeral: true });
			}
		}
	}
	// We can add more interaction types here like isSelectMenu(), isModalSubmit() etc.
});

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, readyClient => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Log in to Discord with your client's token
client.login(token);
