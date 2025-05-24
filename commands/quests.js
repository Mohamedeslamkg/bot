const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');
const { handleLevelUp } = require('../bossBattleManager.js'); // Assuming handleLevelUp is exported from here or a shared util

// Database path
const dbPath = path.join(__dirname, '..', 'data', 'shadow_realms.db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quests')
        .setDescription('Manages your quests in the Shadow Realms.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Lists available or active quests in your current world.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('accept')
                .setDescription('Accepts an available quest.')
                .addStringOption(option =>
                    option.setName('quest_name')
                        .setDescription('The exact name of the quest you want to accept.')
                        .setRequired(true)))
        .addSubcommand(subcommand => // New subcommand
            subcommand
                .setName('handin')
                .setDescription('Hands in a completed quest to receive rewards.')
                .addStringOption(option =>
                    option.setName('quest_name')
                        .setDescription('The exact name of the completed quest you want to hand in.')
                        .setRequired(true))),

    async execute(interaction) {
        const userId = interaction.user.id;
        const serverId = interaction.guild.id;
        const channelId = interaction.channel.id; // Needed for world context in 'list'
        const subcommand = interaction.options.getSubcommand();

        // Defer reply for all subcommands to ensure timely response
        // For 'list', it's ephemeral. For 'handin' by command, also ephemeral.
        // Button interactions will use interaction.update() which also needs initial deferral or reply.
        await interaction.deferReply({ ephemeral: true });

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, async (err) => {
            if (err) {
                console.error('Quests - Error opening database:', err.message);
                await interaction.editReply({ content: 'Failed to connect to the game database. Please try again later.' });
                return;
            }

            try {
                const player = await new Promise((resolve, reject) => {
                    db.get(`SELECT player_id, inventory FROM players WHERE discord_user_id = ? AND server_id = ?`, [userId, serverId], (e, row) => e ? reject(e) : resolve(row));
                });

                if (!player) {
                    await interaction.editReply({ content: 'You need to create a character first using `/create-character`.' });
                    return;
                }
                const playerId = player.player_id;
                const playerInventory = JSON.parse(player.inventory || '[]');

                if (subcommand === 'list') {
                    const worldRow = await new Promise((resolve, reject) => {
                        db.get(`SELECT w.name as world_name FROM worlds w JOIN world_channels wc ON w.world_id = wc.world_id WHERE wc.channel_id = ? AND w.server_id = ?`, [channelId, serverId], (e, row) => e ? reject(e) : resolve(row));
                    });

                    if (!worldRow) {
                        await interaction.editReply({ content: 'You must be in a world-specific channel to list quests.' });
                        return;
                    }
                    const currentWorldName = worldRow.world_name;

                    const quests = await new Promise((resolve, reject) => {
                        db.all(`
                            SELECT q.quest_id, q.name, q.description, q.xp_reward, q.coins_reward, i.name as item_reward_name, q.item_reward_quantity, pq.status, pq.current_progress, q.target_quantity, q.type
                            FROM quests q
                            LEFT JOIN items i ON q.item_reward_id = i.item_id
                            LEFT JOIN player_quests pq ON q.quest_id = pq.quest_id AND pq.player_id = ?
                            WHERE q.world_name = ? OR pq.player_id = ? 
                            ORDER BY CASE 
                                WHEN pq.status = 'ACCEPTED' THEN 1
                                WHEN pq.status = 'COMPLETED_PENDING_REWARD' THEN 2
                                WHEN pq.status IS NULL THEN 3 
                                WHEN pq.status = 'COMPLETED_REWARDED' THEN 4
                                ELSE 5 
                            END, q.quest_id
                        `, [playerId, currentWorldName, playerId], (e, rows) => e ? reject(e) : resolve(rows));
                    });
                    
                    if (quests.length === 0) {
                        await interaction.editReply({ content: `No quests found for you in **${currentWorldName}** or assigned to you globally.` });
                        return;
                    }
                    
                    const listEmbed = new EmbedBuilder().setColor(0x0099FF).setTitle(`📜 Quests`).setTimestamp();
                    const components = [];
                    let fieldsAdded = 0;

                    for (const q of quests) {
                        if (fieldsAdded >= 5 && components.length >= 5) break;

                        let statusEmoji = '❓'; // Available (not accepted or not in this world but assigned)
                        let progressText = '';
                        let canAccept = !q.status; // Can accept if no player_quest entry
                        let canHandIn = q.status === 'COMPLETED_PENDING_REWARD';

                        if (q.status === 'ACCEPTED' || q.status === 'IN_PROGRESS') {
                            statusEmoji = '⏳';
                            progressText = q.type === 'KILL' || q.type === 'COLLECT' ? ` (${q.current_progress || 0}/${q.target_quantity || 'N/A'})` : '';
                            canAccept = false;
                        } else if (q.status === 'COMPLETED_PENDING_REWARD') {
                            statusEmoji = '✅';
                            canAccept = false;
                        } else if (q.status === 'COMPLETED_REWARDED') {
                            statusEmoji = '✔️';
                            canAccept = false;
                            canHandIn = false;
                        }
                        
                        let fieldDescription = `${q.description}\n**Rewards:** ${q.xp_reward} XP, ${q.coins_reward} Coins`;
                        if (q.item_reward_name) fieldDescription += `, ${q.item_reward_quantity}x ${q.item_reward_name}`;
                        if (q.world_name !== currentWorldName && q.status) fieldDescription += `\n*(World: ${q.world_name})*`;


                        if (fieldsAdded < 25) {
                            listEmbed.addFields({ name: `${statusEmoji} ${q.name}${progressText}`, value: fieldDescription });
                            fieldsAdded++;
                        }

                        if (components.length < 5) {
                            if (canAccept && q.world_name === currentWorldName) { // Only allow accepting quests from current world via list
                                components.push(new ActionRowBuilder().addComponents(
                                    new ButtonBuilder().setCustomId(`quest_accept_${q.quest_id}`).setLabel(`Accept "${q.name.substring(0, 20)}"`).setStyle(ButtonStyle.Success)
                                ));
                            } else if (canHandIn) {
                                components.push(new ActionRowBuilder().addComponents(
                                    new ButtonBuilder().setCustomId(`quest_handin_${q.quest_id}`).setLabel(`💰 Hand In "${q.name.substring(0, 20)}"`).setStyle(ButtonStyle.Primary)
                                ));
                            }
                        }
                    }
                     if (listEmbed.data.fields && listEmbed.data.fields.length === 0) listEmbed.setDescription("No quests to display based on current filters or world.");
                    await interaction.editReply({ embeds: [listEmbed], components: components });

                } else if (subcommand === 'accept') {
                    const questNameToAccept = interaction.options.getString('quest_name');
                    // ... (accept logic - mostly handled by button now, but keep for direct command use) ...
                    // This needs to be refactored to use a shared "processAcceptQuest" function if used by button too
                    await interaction.editReply({content: `Accepting "${questNameToAccept}" (Functionality primarily via buttons in list).`});


                } else if (subcommand === 'handin') {
                    const questNameToHandIn = interaction.options.getString('quest_name');
                    const questDetails = await new Promise((resolve, reject) => {
                        db.get(`SELECT q.*, i.name as item_reward_name 
                                FROM quests q 
                                LEFT JOIN items i ON q.item_reward_id = i.item_id
                                WHERE q.name = ?`, [questNameToHandIn], (e, row) => e ? reject(e) : resolve(row));
                    });
                    if (!questDetails) {
                        await interaction.editReply({ content: `Quest "${questNameToHandIn}" not found.` });
                        return;
                    }
                    await processQuestHandin(interaction, playerId, questDetails.quest_id, questDetails, db, false, playerInventory);
                }
            } catch (e) {
                console.error("Quests command - main error block:", e);
                if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "An error occurred.", ephemeral: true }).catch(console.error);
                else await interaction.editReply({ content: "An error occurred." }).catch(console.error);
            } finally {
                if (db && db.open) db.close();
            }
        });
    },

    async handleQuestButton(interaction) {
        await interaction.deferUpdate(); 
        const customIdParts = interaction.customId.split('_');
        const action = customIdParts[1]; 
        const questId = parseInt(customIdParts[2], 10);
        const userId = interaction.user.id; 
        const serverId = interaction.guild.id; 

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, async (dbErr) => {
            if (dbErr) {
                console.error('QuestButton - DB Open Error:', dbErr.message);
                await interaction.editReply({ content: 'Database error. Could not process quest action.', components: [] });
                return;
            }
            try {
                const player = await new Promise((resolve, reject) => {
                    db.get(`SELECT player_id, inventory FROM players WHERE discord_user_id = ? AND server_id = ?`, [userId, serverId], (e,r) => e ? reject(e) : resolve(r));
                });
                if (!player) {
                    await interaction.editReply({ content: 'Could not find your character.', components: [] });
                    return;
                }
                const playerId = player.player_id;
                const playerInventory = JSON.parse(player.inventory || '[]');

                const questDetails = await new Promise((resolve, reject) => {
                    db.get(`SELECT q.*, i.name as item_reward_name 
                            FROM quests q 
                            LEFT JOIN items i ON q.item_reward_id = i.item_id
                            WHERE q.quest_id = ?`, [questId], (e,r) => e ? reject(e) : resolve(r));
                });
                if (!questDetails) {
                    await interaction.editReply({ content: 'Quest details not found.', components: [] });
                    return;
                }

                if (action === 'accept') {
                    // ... (accept logic, similar to before but using editReply) ...
                    const existingPlayerQuest = await new Promise((resolve, reject) => db.get(`SELECT * FROM player_quests WHERE player_id = ? AND quest_id = ?`, [playerId, questId], (e,r)=>e?reject(e):resolve(r)));
                    if (existingPlayerQuest) {
                        await interaction.editReply({ content: `You have already interacted with "${questDetails.name}". Status: ${existingPlayerQuest.status}.`, components: [] });
                        return;
                    }
                    if (questDetails.prerequisite_quest_id) {
                        const prereqStatus = await new Promise((resolve, reject) => db.get(`SELECT status FROM player_quests WHERE player_id = ? AND quest_id = ?`, [playerId, questDetails.prerequisite_quest_id], (e,r)=>e?reject(e):resolve(r)));
                        if (!prereqStatus || (prereqStatus.status !== 'COMPLETED_REWARDED' && prereqStatus.status !== 'COMPLETED_PENDING_REWARD')) {
                            await interaction.editReply({ content: `Prerequisite not met for "${questDetails.name}".`, components: [] });
                            return;
                        }
                    }
                    await new Promise((resolve, reject) => db.run(`INSERT INTO player_quests (player_id, quest_id, status) VALUES (?, ?, 'ACCEPTED')`, [playerId, questId], e=>e?reject(e):resolve()));
                    await interaction.editReply({ content: `✅ Quest "**${questDetails.name}**" accepted!`, components: [] });

                } else if (action === 'handin') {
                    await processQuestHandin(interaction, playerId, questId, questDetails, db, true, playerInventory);
                } else {
                    await interaction.editReply({ content: `Unknown quest action: ${action}`, components: [] });
                }
            } catch (e) {
                console.error('QuestButton - Handler Error:', e);
                await interaction.editReply({ content: 'An error occurred processing the quest action.', components: [] }).catch(console.error);
            } finally {
                if (db && db.open) db.close();
            }
        });
    }
};

async function processQuestHandin(interaction, playerId, questId, questDetails, db, isButtonInteraction, playerInventory) {
    try {
        const playerQuestInfo = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM player_quests WHERE player_id = ? AND quest_id = ?`, [playerId, questId], (e,r)=>e?reject(e):resolve(r));
        });

        if (!playerQuestInfo) {
            const msg = `You don't seem to have the quest "${questDetails.name}" active.`;
            isButtonInteraction ? await interaction.editReply({ content: msg, components: [] }) : await interaction.followUp({ content: msg, ephemeral: true });
            return;
        }

        if (playerQuestInfo.status !== 'COMPLETED_PENDING_REWARD') {
            let msg = `Cannot hand in "${questDetails.name}". `;
            if (playerQuestInfo.status === 'COMPLETED_REWARDED') msg += `Already completed.`;
            else msg += `Not yet completed (Progress: ${playerQuestInfo.current_progress}/${questDetails.target_quantity}).`;
            isButtonInteraction ? await interaction.editReply({ content: msg, components: [] }) : await interaction.followUp({ content: msg, ephemeral: true });
            return;
        }

        await new Promise((resolve, reject) => db.run("BEGIN TRANSACTION", e => e ? reject(e) : resolve()));

        let playerData = await new Promise((resolve, reject) => { // Fetch full player data for updates
            db.get("SELECT * FROM players WHERE player_id = ?", [playerId], (e,r)=>e?reject(e):resolve(r));
        });
        if(!playerData) throw new Error("Player data not found during hand-in.");


        let rewardMessages = [];
        playerData.xp += questDetails.xp_reward;
        rewardMessages.push(`🌟 ${questDetails.xp_reward} XP`);

        playerData.shadow_coins += questDetails.coins_reward;
        rewardMessages.push(`💰 ${questDetails.coins_reward} Coins`);
        
        let currentInventory = JSON.parse(playerData.inventory || '[]'); // Use playerData's inventory

        if (questDetails.item_reward_id && questDetails.item_reward_quantity > 0) {
            const itemIndex = currentInventory.findIndex(item => item.item_name === questDetails.item_reward_name);
            if (itemIndex > -1) {
                currentInventory[itemIndex].quantity += questDetails.item_reward_quantity;
            } else {
                currentInventory.push({ item_name: questDetails.item_reward_name, quantity: questDetails.item_reward_quantity });
            }
            rewardMessages.push(`🎁 ${questDetails.item_reward_quantity}x ${questDetails.item_reward_name}`);
        }
        
        const { leveledUp, levelUpMessages } = await handleLevelUp(db, playerData); // Pass full playerData
        if (leveledUp) {
            rewardMessages.push(levelUpMessages);
            // HP/MP/Stats are updated directly on playerData object by handleLevelUp
        }

        await new Promise((resolve, reject) => {
            db.run(`UPDATE players SET xp = ?, shadow_coins = ?, inventory = ?, level = ?, hp = ?, mp = ?, strength = ?, defense = ?, intelligence = ?, speed = ? WHERE player_id = ?`,
                   [playerData.xp, playerData.shadow_coins, JSON.stringify(currentInventory), playerData.level, playerData.hp, playerData.mp, playerData.strength, playerData.defense, playerData.intelligence, playerData.speed, playerId], 
                   e => e ? reject(e) : resolve());
        });
        
        await new Promise((resolve, reject) => {
            db.run(`UPDATE player_quests SET status = 'COMPLETED_REWARDED' WHERE player_quest_id = ?`, 
                   [playerQuestInfo.player_quest_id], 
                   e => e ? reject(e) : resolve());
        });

        await new Promise((resolve, reject) => db.run("COMMIT", e => e ? reject(e) : resolve()));

        const successMsg = `🎉 Quest Handed In: "**${questDetails.name}**"!\nYou received: ${rewardMessages.join(', ')}.`;
        isButtonInteraction ? await interaction.editReply({ content: successMsg, components: [] }) : await interaction.followUp({ content: successMsg, ephemeral: true });

    } catch (error) {
        console.error("Error processing quest hand-in:", error);
        await new Promise((resolve, reject) => db.run("ROLLBACK", e => e ? reject(e) : resolve()));
        const errorMsg = "An error occurred while handing in the quest.";
        isButtonInteraction ? await interaction.editReply({ content: errorMsg, components: [] }).catch(console.error) : await interaction.followUp({ content: errorMsg, ephemeral: true }).catch(console.error);
    } 
    // db.close() should be handled by the main execute/handleQuestButton function
}
