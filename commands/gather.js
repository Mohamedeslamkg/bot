const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');

// Database path
const dbPath = path.join(__dirname, '..', 'data', 'shadow_realms.db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gather')
        .setDescription('Gather resources from the current world.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Lists available gathering nodes in your current area.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('node')
                .setDescription('Attempts to gather from a specific node.')
                .addStringOption(option =>
                    option.setName('node_name')
                        .setDescription('The name of the node you want to gather from.')
                        .setRequired(true))),

    async execute(interaction) {
        const userId = interaction.user.id;
        const serverId = interaction.guild.id;
        const channelId = interaction.channel.id;
        const subcommand = interaction.options.getSubcommand();

        await interaction.deferReply({ ephemeral: true });

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
            if (err) {
                console.error('Gather - Error opening database:', err.message);
                interaction.followUp({ content: 'Failed to connect to the game database. Please try again later.', ephemeral: true });
                return;
            }
        });

        // Get Player ID first
        db.get(`SELECT player_id FROM players WHERE discord_user_id = ? AND server_id = ?`, [userId, serverId], (err, player) => {
            if (err || !player) {
                interaction.followUp({ content: 'You need to create a character first using `/create-character`.', ephemeral: true });
                db.close();
                return;
            }
            const playerId = player.player_id;

            // Get current world name
            db.get(`SELECT w.name as world_name 
                    FROM worlds w 
                    JOIN world_channels wc ON w.world_id = wc.world_id 
                    WHERE wc.channel_id = ? AND w.server_id = ?`, 
                    [channelId, serverId], async (err, worldRow) => {
                if (err) {
                    console.error('Gather - Error fetching world data:', err.message);
                    await interaction.followUp({ content: 'Error trying to determine your current location. Please try again.', ephemeral: true });
                    db.close();
                    return;
                }
                if (!worldRow) {
                    await interaction.followUp({ content: 'You must be in a world-specific channel (e.g., #Fire-World-Text) to gather resources.', ephemeral: true });
                    db.close();
                    return;
                }
                const currentWorldName = worldRow.world_name;

                if (subcommand === 'list') {
                    const currentTime = Math.floor(Date.now() / 1000);
                    db.all(`
                        SELECT gn.node_id, gn.name, gn.cooldown_seconds, i.name as item_yield_name, rt.name as required_tool_name,
                               pnc.last_gathered_timestamp
                        FROM gathering_nodes gn
                        JOIN items i ON gn.item_id_yield = i.item_id
                        LEFT JOIN items rt ON gn.required_tool_id = rt.item_id
                        LEFT JOIN player_node_cooldowns pnc ON gn.node_id = pnc.node_id AND pnc.player_id = ?
                        WHERE gn.world_name = ?
                        ORDER BY gn.name
                    `, [playerId, currentWorldName], async (err, nodes) => {
                        if (err) {
                            console.error('Gather list - Error fetching nodes:', err.message);
                            await interaction.followUp({ content: 'There was an error fetching gathering nodes for this area.', ephemeral: true });
                            db.close();
                            return;
                        }

                        if (nodes.length === 0) {
                            await interaction.followUp({ content: `There are no known gathering nodes in **${currentWorldName}**.`, ephemeral: true });
                            db.close();
                            return;
                        }

                        const listEmbed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle(`⛏️ Gathering Nodes in ${currentWorldName}`)
                            .setTimestamp();
                        
                        const components = [];
                        let fieldsAdded = 0;

                        for (const node of nodes) {
                            if (fieldsAdded >= 5 && components.length >=5) break; // Limit to 5 nodes with buttons for now

                            const cooldownOverTime = (node.last_gathered_timestamp || 0) + node.cooldown_seconds;
                            const remainingCooldown = Math.max(0, cooldownOverTime - currentTime);
                            const isOnCooldown = remainingCooldown > 0;

                            let nodeStatus = isOnCooldown ? `⏳ Cooldown: ${remainingCooldown}s` : '✅ Ready';
                            let nodeDescription = `Yields: **${node.item_yield_name}**`;
                            if (node.required_tool_name) {
                                nodeDescription += `\nRequires: *${node.required_tool_name}*`;
                            } else {
                                nodeDescription += `\n*No tool required*`;
                            }
                            
                            if (fieldsAdded < 25) { // Embed field limit
                                listEmbed.addFields({ name: `${node.name} (${nodeStatus})`, value: nodeDescription });
                                fieldsAdded++;
                            }

                            if (components.length < 5 && !isOnCooldown) { // Only add button if not on cooldown
                                const gatherButton = new ButtonBuilder()
                                    .setCustomId(`gather_node_${node.node_id}`)
                                    .setLabel(`Gather ${node.name.substring(0, 50)}`)
                                    .setStyle(ButtonStyle.Primary);
                                components.push(new ActionRowBuilder().addComponents(gatherButton));
                            }
                        }
                         if (nodes.length > fieldsAdded) {
                            listEmbed.setFooter({text: `Showing ${fieldsAdded} of ${nodes.length} nodes. More may be available.`});
                        }


                        await interaction.followUp({ embeds: [listEmbed], components: components, ephemeral: true });
                        db.close();
                    });
                } else if (subcommand === 'node') {
                    // Logic for /gather node <node_name> will be implemented in the next step
                    const nodeNameInput = interaction.options.getString('node_name');
                    // Logic for /gather node <node_name>
                    const nodeNameInput = interaction.options.getString('node_name');
                    await processGathering(interaction, playerId, currentWorldName, nodeNameInput, null, db);
                    // db.close() will be handled by processGathering
                }
            });
        });
    },

    async handleGatherButton(interaction) {
        // await interaction.deferReply({ ephemeral: true }); // Already deferred in the main command or should be handled carefully if not
        const customIdParts = interaction.customId.split('_'); // gather_node_nodeId
        const nodeId = parseInt(customIdParts[2], 10);
        const userId = interaction.user.id; // Discord User ID
        const serverId = interaction.guild.id; // Server ID
        
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, async (dbErr) => {
            if (dbErr) {
                console.error('GatherButton - DB Open Error:', dbErr.message);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'Database error. Could not process gather action.', ephemeral: true });
                } else {
                     await interaction.followUp({ content: 'Database error. Could not process gather action.', ephemeral: true });
                }
                return;
            }

            try {
                const player = await new Promise((resolve, reject) => {
                    db.get(`SELECT player_id FROM players WHERE discord_user_id = ? AND server_id = ?`, [userId, serverId], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });

                if (!player) {
                    await interaction.followUp({ content: 'Could not find your character. Please create one first.', ephemeral: true });
                    db.close(); return;
                }
                const playerId = player.player_id;
                
                // We need world_name if it's not passed or easily available
                // For button interactions, the world context is from where the button was pressed, but not directly available here
                // This is a simplification; ideally, world_name would be part of customId or fetched based on channel if necessary
                // For now, processGathering will fetch node details which includes world_name.
                await processGathering(interaction, playerId, null, null, nodeId, db);

            } catch (error) {
                console.error('GatherButton - Handler Error:', error);
                 if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'An error occurred processing the gather action.', ephemeral: true});
                } else if (interaction.deferred && !interaction.replied) {
                     await interaction.editReply({ content: 'An error occurred processing the gather action.', components: [] });
                } else {
                    await interaction.followUp({ content: 'An error occurred processing the gather action.', ephemeral: true });
                }
                if(db) db.close();
            }
            // db.close() is handled by processGathering or in error cases
        });
    }
};

async function processGathering(interaction, playerId, worldNameForList, nodeNameInput, nodeIdInput, db) {
    const currentTime = Math.floor(Date.now() / 1000);
    let nodeToGather;

    try {
        if (nodeIdInput) { // Gathering via button
            nodeToGather = await new Promise((resolve, reject) => {
                db.get(`SELECT gn.*, i.name as item_yield_name, rt.name as required_tool_name 
                        FROM gathering_nodes gn 
                        JOIN items i ON gn.item_id_yield = i.item_id
                        LEFT JOIN items rt ON gn.required_tool_id = rt.item_id
                        WHERE gn.node_id = ?`, [nodeIdInput], (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });
        } else { // Gathering via /gather node <name>
            nodeToGather = await new Promise((resolve, reject) => {
                db.get(`SELECT gn.*, i.name as item_yield_name, rt.name as required_tool_name 
                        FROM gathering_nodes gn
                        JOIN items i ON gn.item_id_yield = i.item_id
                        LEFT JOIN items rt ON gn.required_tool_id = rt.item_id
                        WHERE gn.name = ? AND gn.world_name = ?`, [nodeNameInput, worldNameForList], (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });
        }

        if (!nodeToGather) {
            await interaction.followUp({ content: `Gathering node "${nodeNameInput || `ID ${nodeIdInput}`}" not found in this area or does not exist.`, ephemeral: true });
            db.close(); return;
        }

        // Check cooldown
        const cooldownInfo = await new Promise((resolve, reject) => {
            db.get('SELECT last_gathered_timestamp FROM player_node_cooldowns WHERE player_id = ? AND node_id = ?', [playerId, nodeToGather.node_id], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });

        if (cooldownInfo) {
            const cooldownOverTime = cooldownInfo.last_gathered_timestamp + nodeToGather.cooldown_seconds;
            const remainingCooldown = Math.max(0, cooldownOverTime - currentTime);
            if (remainingCooldown > 0) {
                await interaction.followUp({ content: `**${nodeToGather.name}** is still on cooldown. Time remaining: ${remainingCooldown}s.`, ephemeral: true });
                db.close(); return;
            }
        }

        // Check for required tool
        let playerInventory = await new Promise((resolve, reject) => {
            db.get('SELECT inventory FROM players WHERE player_id = ?', [playerId], (err, row) => {
                if (err || !row) reject(new Error('Player inventory not found.'));
                else resolve(JSON.parse(row.inventory || '[]'));
            });
        });

        if (nodeToGather.required_tool_id) {
            const hasTool = playerInventory.some(invItem => invItem.item_name === nodeToGather.required_tool_name); // Assumes item_name is unique
            if (!hasTool) {
                await interaction.followUp({ content: `You need a **${nodeToGather.required_tool_name}** to gather from ${nodeToGather.name}.`, ephemeral: true });
                db.close(); return;
            }
        }
        
        // (Optional: Check skill level requirement - not implemented yet)

        // Perform gathering
        const quantityGathered = Math.floor(Math.random() * (nodeToGather.quantity_max - nodeToGather.quantity_min + 1)) + nodeToGather.quantity_min;
        
        const itemIndexInInventory = playerInventory.findIndex(item => item.item_name === nodeToGather.item_yield_name);
        if (itemIndexInInventory > -1) {
            playerInventory[itemIndexInInventory].quantity += quantityGathered;
        } else {
            playerInventory.push({ item_name: nodeToGather.item_yield_name, quantity: quantityGathered });
        }
        const newInventoryJson = JSON.stringify(playerInventory);

        // Update player inventory and cooldown in a transaction
        await new Promise((resolve, reject) => db.run('BEGIN TRANSACTION', (err) => err ? reject(err) : resolve()));
        
        await new Promise((resolve, reject) => {
            db.run('UPDATE players SET inventory = ? WHERE player_id = ?', [newInventoryJson, playerId], function(err) {
                if (err) reject(err); else resolve(this);
            });
        });

        await new Promise((resolve, reject) => {
            db.run('REPLACE INTO player_node_cooldowns (player_id, node_id, last_gathered_timestamp) VALUES (?, ?, ?)', 
                   [playerId, nodeToGather.node_id, currentTime], function(err) {
                if (err) reject(err); else resolve(this);
            });
        });

        await new Promise((resolve, reject) => db.run('COMMIT', (err) => err ? reject(err) : resolve()));

        await interaction.followUp({ content: `Successfully gathered **${quantityGathered}x ${nodeToGather.item_yield_name}** from ${nodeToGather.name}! It will be available again in ${nodeToGather.cooldown_seconds}s.`, ephemeral: true });

    } catch (error) {
        console.error('Error during gathering process:', error);
        await new Promise((resolve, reject) => db.run('ROLLBACK', (err) => err ? reject(err) : resolve())); // Attempt rollback
        await interaction.followUp({ content: 'An error occurred while trying to gather. Please try again.', ephemeral: true });
    } finally {
        if (db) db.close();
    }
}
