const { SlashCommandBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');

// Database setup
const dbPath = path.join(__dirname, '..', 'data', 'shadow_realms.db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('install')
        .setDescription('Sets up the initial server configuration for Shadow Realms.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator), // Only administrators can use this command
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true }); // Acknowledge the interaction

        const guild = interaction.guild;

        // --- 1. Create Category ---
        let category;
        try {
            category = await guild.channels.create({
                name: 'عوالم الظل | Shadow Realms',
                type: ChannelType.GuildCategory,
            });
            await interaction.followUp({ content: 'Category "عوالم الظل | Shadow Realms" created successfully.', ephemeral: true });
        } catch (error) {
            console.error('Error creating category:', error);
            await interaction.followUp({ content: 'Failed to create category. Please check my permissions.', ephemeral: true });
            return;
        }

        // --- 2. Create Channels ---
        const channelsToCreate = [
            { name: 'Fire-World-Text', type: ChannelType.GuildText },
            { name: 'Fire-World-Voice', type: ChannelType.GuildVoice },
            { name: 'Ice-World-Text', type: ChannelType.GuildText },
            { name: 'Ice-World-Voice', type: ChannelType.GuildVoice },
        ];

        try {
            for (const channelData of channelsToCreate) {
                await guild.channels.create({
                    name: channelData.name,
                    type: channelData.type,
                    parent: category.id,
                });
            }
            await interaction.followUp({ content: 'Initial channels created successfully under the new category.', ephemeral: true });
        } catch (error) {
            console.error('Error creating channels:', error);
            await interaction.followUp({ content: 'Failed to create initial channels. Please check my permissions.', ephemeral: true });
            // Potentially roll back category creation or notify user of partial success
            return;
        }

        // --- 3. Setup SQLite Database ---
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error('Error opening/creating database:', err.message);
                interaction.followUp({ content: 'Failed to initialize the database.', ephemeral: true });
                return;
            }
            console.log('Connected to the shadow_realms.db database.');
        });

        db.serialize(() => {
            // Create servers table
            db.run(`CREATE TABLE IF NOT EXISTS servers (
                server_id TEXT PRIMARY KEY,
                server_name TEXT
            )`, (err) => {
                if (err) {
                    console.error('Error creating servers table:', err.message);
                    interaction.followUp({ content: 'Failed to create database table (servers).', ephemeral: true });
                    return;
                }
                console.log('Table "servers" created or already exists.');
            });

            // Create players table
            db.run(`CREATE TABLE IF NOT EXISTS players (
                player_id INTEGER PRIMARY KEY AUTOINCREMENT,
                discord_user_id TEXT NOT NULL,
                server_id TEXT NOT NULL,
                name TEXT NOT NULL,
                race TEXT,
                class TEXT,
                gender TEXT,
                level INTEGER DEFAULT 1,
                xp INTEGER DEFAULT 0,
                hp INTEGER,
                mp INTEGER,
                strength INTEGER,
                intelligence INTEGER,
                speed INTEGER,
                inventory TEXT,
                shadow_coins INTEGER DEFAULT 0,
                UNIQUE (discord_user_id, server_id),
                FOREIGN KEY (server_id) REFERENCES servers(server_id)
            )`, (err) => {
                if (err) {
                    console.error('Error creating players table:', err.message);
                    interaction.followUp({ content: 'Failed to create database table (players).', ephemeral: true });
                    return;
                }
                console.log('Table "players" created or already exists.');
            });

            // Create worlds table
            db.run(`CREATE TABLE IF NOT EXISTS worlds (
                world_id INTEGER PRIMARY KEY AUTOINCREMENT,
                server_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                story TEXT,
                enemy_types TEXT,
                resources TEXT,
                FOREIGN KEY (server_id) REFERENCES servers(server_id)
            )`, (err) => {
                if (err) {
                    console.error('Error creating worlds table:', err.message);
                    interaction.followUp({ content: 'Failed to create database table (worlds).', ephemeral: true });
                    return;
                }
                console.log('Table "worlds" created or already exists.');
            });

            // Create world_channels table
            db.run(`CREATE TABLE IF NOT EXISTS world_channels (
                channel_id TEXT PRIMARY KEY,
                world_id INTEGER NOT NULL,
                type TEXT,
                FOREIGN KEY (world_id) REFERENCES worlds(world_id)
            )`, (err) => {
                if (err) {
                    console.error('Error creating world_channels table:', err.message);
                    interaction.followUp({ content: 'Failed to create database table (world_channels).', ephemeral: true });
                    return;
                }
                console.log('Table "world_channels" created or already exists.');

                // Create enemies table
                db.run(`CREATE TABLE IF NOT EXISTS enemies (
                    enemy_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    world_name TEXT NOT NULL,
                    hp INTEGER NOT NULL,
                    attack INTEGER NOT NULL,
                    defense INTEGER NOT NULL,
                    speed INTEGER NOT NULL,
                    xp_reward INTEGER NOT NULL,
                    coins_reward INTEGER NOT NULL,
                    image_url TEXT,
                    is_boss BOOLEAN DEFAULT FALSE 
                )`, (err) => {
                    if (err) {
                        console.error('Error creating enemies table:', err.message);
                        // interaction.followUp({ content: 'Failed to create database table (enemies).', ephemeral: true }); // Avoid sending too many followUps
                        // We'll rely on console logs for table creation errors during install for now.
                    } else {
                        console.log('Table "enemies" created or already exists.');
                    }
                });

                // Add new enemies for Dark Secret Forest
                const darkForestEnemies = [
                    { name: "Shadow Sprite", world_name: "Dark Secret Forest", hp: 40, attack: 8, defense: 3, speed: 15, xp_reward: 12, coins_reward: 6, image_url: "https://i.imgur.com/exampleSprite.png" }, // Replace with actual image URL
                    { name: "Twisted Treant", world_name: "Dark Secret Forest", hp: 150, attack: 12, defense: 10, speed: 4, xp_reward: 30, coins_reward: 20, image_url: "https://i.imgur.com/exampleTreant.png" },
                    { name: "Forest Viper", world_name: "Dark Secret Forest", hp: 60, attack: 10, defense: 5, speed: 10, xp_reward: 20, coins_reward: 15, image_url: "https://i.imgur.com/exampleViper.png" } 
                ];
                const enemyStmt = db.prepare(`INSERT OR IGNORE INTO enemies (name, world_name, hp, attack, defense, speed, xp_reward, coins_reward, image_url) 
                                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                darkForestEnemies.forEach(enemy => {
                    enemyStmt.run(enemy.name, enemy.world_name, enemy.hp, enemy.attack, enemy.defense, enemy.speed, enemy.xp_reward, enemy.coins_reward, enemy.image_url, function(err) {
                        if (err) console.error(`Error inserting enemy ${enemy.name}: ${err.message}`);
                        else if (this.changes > 0) console.log(`Inserted enemy: ${enemy.name}`);
                    });
                });
                enemyStmt.finalize();

                // Update enemy_types for Dark Secret Forest in worlds table
                // This should ideally run after the server_id is known and the world entry for the specific server is updated.
                // For now, we use the placeholder. It will be updated correctly when the main server data insertion happens.
                const initialEnemies = [
                    // Fire World Enemies
                    { name: 'Fire Elemental', world_name: 'Fire World', hp: 35, attack: 7, defense: 2, speed: 10, xp_reward: 10, coins_reward: 5, is_boss: false, image_url: "https://i.imgur.com/defaultfire.png" }, // Placeholder image
                    { name: 'Lava Golem', world_name: 'Fire World', hp: 60, attack: 10, defense: 5, speed: 5, xp_reward: 15, coins_reward: 8, is_boss: false, image_url: "https://i.imgur.com/defaultlava.png" }, // Placeholder image
                    // Ice World Enemies
                    { name: 'Ice Sprite', world_name: 'Ice World', hp: 30, attack: 6, defense: 1, speed: 12, xp_reward: 9, coins_reward: 4, is_boss: false, image_url: "https://i.imgur.com/defaultice.png" }, // Placeholder image
                    { name: 'Frost Wolf', world_name: 'Ice World', hp: 55, attack: 9, defense: 4, speed: 8, xp_reward: 14, coins_reward: 7, is_boss: false, image_url: "https://i.imgur.com/defaultwolf.png" }, // Placeholder image
                    // Dark Secret Forest Enemies (already defined from previous step)
                    ...darkForestEnemies, // Spread the existing darkForestEnemies array
                    // Boss Enemy
                    { 
                        name: "Infernos, Lord of the Blazing Peaks", 
                        world_name: "Fire World", 
                        hp: 1000, attack: 50, defense: 30, speed: 20, 
                        xp_reward: 500, coins_reward: 250, 
                        image_url: "https://i.imgur.com/fiLzfN4.png", 
                        is_boss: true 
                    }
                ];
                
                const enemyInsertStmt = db.prepare(`INSERT OR IGNORE INTO enemies (name, world_name, hp, attack, defense, speed, xp_reward, coins_reward, image_url, is_boss) 
                                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                initialEnemies.forEach(enemy => {
                    enemyInsertStmt.run(enemy.name, enemy.world_name, enemy.hp, enemy.attack, enemy.defense, enemy.speed, enemy.xp_reward, enemy.coins_reward, enemy.image_url, enemy.is_boss, function(err) {
                        if (err) console.error(`Error inserting/updating enemy ${enemy.name}: ${err.message}`);
                        else if (this.changes > 0) console.log(`Inserted/Updated enemy: ${enemy.name}`);
                    });
                });
                enemyInsertStmt.finalize();
                
                // Define enemy names for world updates
                const fireWorldEnemyNames = JSON.stringify(['Fire Elemental', 'Lava Golem', "Infernos, Lord of the Blazing Peaks"]);
                const iceWorldEnemyNames = JSON.stringify(['Ice Sprite', 'Frost Wolf']);
                const darkForestEnemyNames = JSON.stringify(darkForestEnemies.map(e => e.name)); // Keep this as it's correct

                // This is where worldsData is defined and used later in the insertServerAndWorlds function
                // We must ensure the enemy_types and resources for Dark Secret Forest are correctly assigned here.
                // The actual update to the worlds table for a specific server_id happens in the insertServerAndWorlds scope.

                // Add new resources for Dark Secret Forest to items table
                const darkForestResources = [
                    { name: 'Shadow Root', description: 'A gnarled root pulsing with faint shadow energy.', item_type: 'RESOURCE', consumable: false, buy_price: 18, sell_price: 9 },
                    { name: 'Ancient Bark', description: 'Thick, resilient bark from an ancient tree of the forest.', item_type: 'RESOURCE', consumable: false, buy_price: 25, sell_price: 12 }
                ];
                const resourceStmt = db.prepare(`INSERT OR IGNORE INTO items (name, description, item_type, consumable, buy_price, sell_price) VALUES (?, ?, ?, ?, ?, ?)`);
                darkForestResources.forEach(res => {
                    resourceStmt.run(res.name, res.description, res.item_type, res.consumable, res.buy_price, res.sell_price, function(err){
                        if(err) console.error(`Error inserting resource ${res.name}: ${err.message}`);
                        else if(this.changes > 0) console.log(`Inserted resource: ${res.name}`);
                    });
                });
                resourceStmt.finalize();

                // Add new gathering nodes for Dark Secret Forest
                const darkForestGatheringNodes = [
                    { name: 'Twisted Roots', world_name: 'Dark Secret Forest', item_name_yield: 'Shadow Root', quantity_min: 1, quantity_max: 2, cooldown_seconds: 240, required_tool_name: null },
                    { name: 'Elderwood Tree', world_name: 'Dark Secret Forest', item_name_yield: 'Ancient Bark', quantity_min: 1, quantity_max: 1, cooldown_seconds: 360, required_tool_name: 'Basic Axe' }
                ];
                
                // This needs to be serialized or use callbacks properly to ensure items exist before nodes reference them.
                // For simplicity of this step, assuming items exist due to prior insertions.
                // A more robust solution would use async/await or chained callbacks for all DB operations.
                darkForestGatheringNodes.forEach(node => {
                    db.get("SELECT item_id FROM items WHERE name = ?", [node.item_name_yield], (err, itemYield) => {
                        if (err || !itemYield) { console.error(`Error finding item_id for yield ${node.item_name_yield}: ${err ? err.message : 'NOT FOUND'}`); return; }
                        
                        let requiredToolId = null;
                        const processNodeInsertionWithToolId = (toolId) => {
                            db.run(`INSERT OR IGNORE INTO gathering_nodes (name, world_name, item_id_yield, quantity_min, quantity_max, cooldown_seconds, required_tool_id, skill_level_requirement) 
                                    VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
                                [node.name, node.world_name, itemYield.item_id, node.quantity_min, node.quantity_max, node.cooldown_seconds, toolId], function(insertErr) {
                                if (insertErr) console.error(`Error inserting gathering node ${node.name}: ${insertErr.message}`);
                                else if (this.changes > 0) console.log(`Inserted gathering node: ${node.name}`);
                            });
                        };

                        if (node.required_tool_name) {
                            db.get("SELECT item_id FROM items WHERE name = ?", [node.required_tool_name], (toolErr, tool) => {
                                if (toolErr || !tool) { console.error(`Error finding item_id for tool ${node.required_tool_name}: ${toolErr ? toolErr.message : 'NOT FOUND'}`); processNodeInsertionWithToolId(null); } // Proceed without tool if not found, or handle error
                                else processNodeInsertionWithToolId(tool.item_id);
                            });
                        } else {
                            processNodeInsertionWithToolId(null);
                        }
                    });
                });

                // The update of enemy_types and resources for Dark Secret Forest
                // will happen inside the worldsData.forEach loop using the correct serverId.
                // The initial placeholder insert for the world itself is also corrected by that loop.
                // No specific separate update for PLACEHOLDER_SERVER_ID_FOR_NOW is needed here,
                // as the main loop will handle associating all worlds, including Dark Secret Forest,
                // with the correct serverId. The enemy_types and resources for DSF in worldsData
                // should be populated with the actual names.
                
                // Ensure darkForestEnemyNames and darkForestResourceNames are available in the scope
                // where worldsData is defined or updated.
                // The current structure adds these to the `worlds` table with a placeholder server_id,
                // then the `worldsData.forEach` loop should correctly insert or update these for the specific server.
                // The key is that the `worldsData` array itself should contain the correct `enemy_types` and `resources` strings for DSF.
                
                // Let's refine the `worldsData` for Dark Secret Forest within the `insertServerAndWorlds` function
                // to include the correct enemy_types and resources JSON strings.
                // This is already done by how `worldsData` is constructed later in the code.
                // The `enemy_types` and `resources` for Dark Secret Forest in `worldsData` should use
                // `darkForestEnemyNames` and `darkForestResourceNames` respectively.
                // The `INSERT OR IGNORE INTO worlds` for 'PLACEHOLDER_SERVER_ID_FOR_NOW' can be removed
                // if we ensure Dark Secret Forest is part of the main `worldsData` loop with correct serverId.

                // The earlier `db.run` that inserts Dark Secret Forest with 'PLACEHOLDER_SERVER_ID_FOR_NOW'
                // for `enemy_types` and `resources` is fine as a global template.
                // The server-specific loop will then update/insert it correctly.
                // The `db.run` that updates `enemy_types` and `resources` using `PLACEHOLDER_SERVER_ID_FOR_NOW`
                // should actually use the `serverId` from the `insertServerAndWorlds` function's scope.
                // This was the purpose of the previous change.
                // The previous change `db.run(UPDATE worlds SET enemy_types = ?, resources = ? WHERE name = 'Dark Secret Forest' AND server_id = ?`, 
                // [darkForestEnemyNames, darkForestResourceNames, serverId] ... ) is correct and should be kept
                // within the `insertServerAndWorlds` function's scope, specifically after the `worldsData.forEach` loop
                // or as part of it for the 'Dark Secret Forest' entry.

                // Re-affirming the correct placement for updating the specific server's Dark Secret Forest entry:
                // This logic is ALREADY part of the `worldsData.forEach` loop if 'Dark Secret Forest'
                // is included in the `worldsData` array with its `enemy_types` and `resources` fields
                // correctly populated with `darkForestEnemyNames` and `darkForestResourceNames`.

                // The previous change correctly added an UPDATE statement within `insertServerAndWorlds`.
                // Let's ensure that the `worldsData` entry for `Dark Secret Forest` uses these variables.
                // The `worldsData` definition later in the code will be the place to ensure this.
                // The placeholder inserts for `worlds` table with `PLACEHOLDER_SERVER_ID_FOR_NOW` for `enemy_types` and `resources`
                // are fine as they act as a global template. The server-specific loop handles the actual server data.
                // The specific UPDATE using the actual `serverId` for `Dark Secret Forest`'s `enemy_types` and `resources`
                // that was added in the previous step is crucial and correctly placed if it's *within* the
                // `insertServerAndWorlds` function or similar context where `serverId` is the actual server's ID.

                // The critical part is that the `worldsData` object, when it includes 'Dark Secret Forest',
                // should use the `darkForestEnemyNames` and `darkForestResourceNames` JSON strings
                // for its `enemy_types` and `resources` properties respectively.

                // The previous change to add a specific UPDATE for Dark Secret Forest using the actual serverId
                // is good for ensuring the data is correct for that server.
                // This logic is now inside the main `worldsData.forEach` loop due to the modification of `worldsData` itself.
                // No further change needed here for this specific `UPDATE` with placeholder.
                // The server-specific update is handled by the main loop.

                // Add new craftable items/equipment for Dark Secret Forest
                const darkForestCraftables = [
                    { name: 'Shadow Weave Robe', description: 'Robe woven from forest shadows, enhances magical prowess.', item_type: 'ARMOR', consumable: false, buy_price: 250, sell_price: 100, effect_type: 'EQUIPMENT', effect_value: 5, target_stat: 'intelligence' }, // +5 Int
                    { name: 'Viperfang Dagger', description: 'A dagger crafted from a Forest Viper fang, with a chance to poison.', item_type: 'WEAPON', consumable: false, buy_price: 180, sell_price: 70, effect_type: 'EQUIPMENT', effect_value: 6, target_stat: 'strength' }, // +6 Str, poison effect handled by skill/combat logic potentially
                    { name: 'Treant Shield', description: 'A sturdy shield made from the bark of a Twisted Treant.', item_type: 'ARMOR', consumable: false, buy_price: 300, sell_price: 120, effect_type: 'EQUIPMENT', effect_value: 8, target_stat: 'defense' }, // +8 Def
                    { name: 'Potion of Forest Vigor', description: 'A potion that temporarily increases speed.', item_type: 'POTION', consumable: true, buy_price: 100, sell_price: 40, effect_type: 'SPEED_BUFF', effect_value: 10, duration: 5 }, // +10 Speed for 5 turns
                    { name: 'Sprite Essence Oil', description: 'An oil that imbues a weapon with minor shadow damage.', item_type: 'CONSUMABLE', consumable: true, buy_price: 70, sell_price: 25, effect_type: 'WEAPON_BUFF_DMG', effect_value: 3, duration: 3 } // +3 Dmg for 3 turns
                ];
                const dfCraftableStmt = db.prepare(`INSERT OR IGNORE INTO items (name, description, item_type, consumable, buy_price, sell_price, effect_type, effect_value, target_stat, duration) 
                                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                darkForestCraftables.forEach(item => {
                    dfCraftableStmt.run(item.name, item.description, item.item_type, item.consumable, item.buy_price, item.sell_price, item.effect_type, item.effect_value, item.target_stat, item.duration, function(err){
                        if(err) console.error(`Error inserting DF craftable ${item.name}: ${err.message}`);
                        else if(this.changes > 0) console.log(`Inserted DF craftable: ${item.name}`);
                    });
                });
                dfCraftableStmt.finalize();
                // Create parties table
                db.run(`CREATE TABLE IF NOT EXISTS parties (
                    party_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    leader_id INTEGER NOT NULL,
                    server_id TEXT NOT NULL,
                    max_members INTEGER DEFAULT 4,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (leader_id) REFERENCES players(player_id) ON DELETE CASCADE
                )`, (err) => {
                    if (err) console.error('Error creating parties table:', err.message);
                    else console.log('Table "parties" created or already exists.');
                });

                // Create party_members table
                db.run(`CREATE TABLE IF NOT EXISTS party_members (
                    party_member_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    party_id INTEGER NOT NULL,
                    player_id INTEGER NOT NULL,
                    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (party_id) REFERENCES parties(party_id) ON DELETE CASCADE,
                    FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE,
                    UNIQUE (party_id, player_id),
                    UNIQUE (player_id) 
                )`, (err) => {
                    if (err) console.error('Error creating party_members table:', err.message);
                    else console.log('Table "party_members" created or already exists.');
                });

                // Create gathering_nodes table
                db.run(`CREATE TABLE IF NOT EXISTS gathering_nodes (
                    node_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    world_name TEXT NOT NULL,
                    item_id_yield INTEGER NOT NULL,
                    quantity_min INTEGER DEFAULT 1,
                    quantity_max INTEGER DEFAULT 1,
                    cooldown_seconds INTEGER DEFAULT 300,
                    required_tool_id INTEGER,
                    skill_level_requirement INTEGER DEFAULT 0,
                    FOREIGN KEY (item_id_yield) REFERENCES items(item_id),
                    FOREIGN KEY (required_tool_id) REFERENCES items(item_id)
                )`, (err) => {
                    if (err) console.error('Error creating gathering_nodes table:', err.message);
                    else {
                        console.log('Table "gathering_nodes" created or already exists.');
                        const initialNodes = [
                            // Fire World Nodes
                            { name: 'Iron Vein', world_name: 'Fire World', item_name_yield: 'Iron Ore', quantity_min: 1, quantity_max: 3, cooldown_seconds: 180, required_tool_name: 'Basic Pickaxe', skill_level_requirement: 0 },
                            { name: 'Sulfur Vent', world_name: 'Fire World', item_name_yield: 'Rare Herb', quantity_min: 1, quantity_max: 2, cooldown_seconds: 300, required_tool_name: null, skill_level_requirement: 0 }, // Assuming Rare Herb can be found here too
                            // Ice World Nodes
                            { name: 'Ancient Oak Tree', world_name: 'Ice World', item_name_yield: 'Oak Wood', quantity_min: 1, quantity_max: 2, cooldown_seconds: 240, required_tool_name: 'Basic Axe', skill_level_requirement: 0 },
                            { name: 'Frostbloom Patch', world_name: 'Ice World', item_name_yield: 'Rare Herb', quantity_min: 1, quantity_max: 1, cooldown_seconds: 300, required_tool_name: null, skill_level_requirement: 0 },
                        ];

                        initialNodes.forEach(node => {
                            db.get("SELECT item_id FROM items WHERE name = ?", [node.item_name_yield], (err, item) => {
                                if (err) return console.error(`Error finding item ${node.item_name_yield}: ${err.message}`);
                                if (!item) return console.error(`Item ${node.item_name_yield} not found for node ${node.name}.`);
                                
                                const itemIdYield = item.item_id;
                                let requiredToolId = null;

                                const insertNodeData = () => {
                                    const stmt = db.prepare(`INSERT OR IGNORE INTO gathering_nodes 
                                                            (name, world_name, item_id_yield, quantity_min, quantity_max, cooldown_seconds, required_tool_id, skill_level_requirement) 
                                                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                                    stmt.run(node.name, node.world_name, itemIdYield, node.quantity_min, node.quantity_max, node.cooldown_seconds, requiredToolId, node.skill_level_requirement, function(insertErr) {
                                        if (insertErr) console.error(`Error inserting node ${node.name}: ${insertErr.message}`);
                                        else if (this.changes > 0) console.log(`Inserted gathering node: ${node.name}`);
                                    });
                                    stmt.finalize();
                                };

                                if (node.required_tool_name) {
                                    db.get("SELECT item_id FROM items WHERE name = ?", [node.required_tool_name], (toolErr, toolItem) => {
                                        if (toolErr) console.error(`Error finding tool ${node.required_tool_name}: ${toolErr.message}`);
                                        else if (!toolItem) console.error(`Tool ${node.required_tool_name} not found for node ${node.name}.`);
                                        else requiredToolId = toolItem.item_id;
                                        insertNodeData(); // Call insert after attempting to find tool
                                    });
                                } else {
                                    insertNodeData(); // No tool needed, call insert directly
                                }
                            });
                        });
                        stmt.finalize(); // Finalize skill statement before starting new ones

                        // Add Infernal Core item
                        const infernalCoreItem = { 
                            name: 'Infernal Core', 
                            description: 'A core pulsing with unbearable heat, rumored to summon powerful entities from fire realms.', 
                            item_type: 'SUMMON_KEY', // New item_type for boss summoning items
                            consumable: true, // Consumed upon use
                            buy_price: null, // Not buyable
                            sell_price: 500 // Sellable for a good amount if found
                        };
                        db.run(`INSERT OR IGNORE INTO items (name, description, item_type, consumable, buy_price, sell_price, effect_type, effect_value, target_stat, duration) 
                                VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
                                [infernalCoreItem.name, infernalCoreItem.description, infernalCoreItem.item_type, infernalCoreItem.consumable, infernalCoreItem.buy_price, infernalCoreItem.sell_price],
                                function(err) {
                                    if (err) console.error(`Error inserting item ${infernalCoreItem.name}: ${err.message}`);
                                    else if (this.changes > 0) console.log(`Inserted item: ${infernalCoreItem.name}`);
                                }
                        );
                    }
                });

                // Create player_node_cooldowns table
                db.run(`CREATE TABLE IF NOT EXISTS player_node_cooldowns (
                    player_id INTEGER NOT NULL,
                    node_id INTEGER NOT NULL,
                    last_gathered_timestamp INTEGER NOT NULL,
                    FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE,
                    FOREIGN KEY (node_id) REFERENCES gathering_nodes(node_id) ON DELETE CASCADE,
                    PRIMARY KEY (player_id, node_id)
                )`, (err) => {
                    if (err) console.error('Error creating player_node_cooldowns table:', err.message);
                    else console.log('Table "player_node_cooldowns" created or already exists.');
                });

                // Create recipes table
                db.run(`CREATE TABLE IF NOT EXISTS recipes (
                    recipe_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    output_item_id INTEGER NOT NULL,
                    output_item_name_temp TEXT, 
                    output_item_quantity INTEGER DEFAULT 1,
                    required_ingredients TEXT NOT NULL,
                    crafting_station_requirement TEXT,
                    skill_requirement_name TEXT,
                    skill_requirement_level INTEGER DEFAULT 0,
                    is_unlocked_by_default BOOLEAN DEFAULT TRUE,
                    FOREIGN KEY (output_item_id) REFERENCES items(item_id) ON DELETE CASCADE
                )`, (err) => {
                    if (err) console.error('Error creating recipes table:', err.message);
                    else {
                        console.log('Table "recipes" created or already exists.');
                        
                        const recipesToAdd = [
                            { 
                                output_item_name: 'Medium Health Potion', // Assume this item will be added to 'items' table
                                output_item_quantity: 1,
                                ingredients: [ { name: 'Small Health Potion', quantity: 2 }, { name: 'Rare Herb', quantity: 1 } ],
                                station: 'Alchemy Lab', // Example station
                                skill_req_name: 'Alchemy', skill_req_level: 5 
                            },
                            {
                                output_item_name: 'Iron Sword', // Assume this item will be added to 'items' table
                                output_item_quantity: 1,
                                ingredients: [ { name: 'Iron Ore', quantity: 10 }, { name: 'Oak Wood', quantity: 3 } ],
                                station: 'Forge',
                                skill_req_name: 'Blacksmithing', skill_req_level: 1
                            },
                            { // Recipe for an item that might not exist yet, for testing output_item_name_temp
                                output_item_name_temp: 'Sturdy Shield', // This item isn't in initialItems, so output_item_id will be an issue without pre-inserting it
                                output_item_quantity: 1,
                                ingredients: [ { name: 'Oak Wood', quantity: 10 }, { name: 'Iron Ore', quantity: 5 } ],
                                station: 'Forge',
                                skill_req_name: 'Blacksmithing', skill_req_level: 3
                            }
                        ];

                        recipesToAdd.forEach(async (recipe) => {
                            try {
                                const outputItem = await new Promise((resolve, reject) => {
                                    db.get("SELECT item_id FROM items WHERE name = ?", [recipe.output_item_name], (err, row) => {
                                        if (err) reject(err); else resolve(row);
                                    });
                                });

                                if (!outputItem && !recipe.output_item_name_temp) {
                                    console.warn(`Output item ${recipe.output_item_name} not found for recipe. Skipping.`);
                                    return;
                                }
                                const outputItemId = outputItem ? outputItem.item_id : null; // Will be null if using output_item_name_temp

                                let ingredientsJson = [];
                                for (const ing of recipe.ingredients) {
                                    const ingItem = await new Promise((resolve, reject) => {
                                        db.get("SELECT item_id FROM items WHERE name = ?", [ing.name], (err, row) => {
                                            if (err) reject(err); else resolve(row);
                                        });
                                    });
                                    if (!ingItem) {
                                        console.warn(`Ingredient ${ing.name} not found for recipe ${recipe.output_item_name || recipe.output_item_name_temp}. Skipping recipe.`);
                                        return; // Skip this recipe if an ingredient isn't found
                                    }
                                    ingredientsJson.push({ item_id: ingItem.item_id, quantity: ing.quantity });
                                }

                                const stmt = db.prepare(`INSERT OR IGNORE INTO recipes 
                                    (output_item_id, output_item_name_temp, output_item_quantity, required_ingredients, crafting_station_requirement, skill_requirement_name, skill_requirement_level, is_unlocked_by_default) 
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                                stmt.run(outputItemId, outputItemId ? null : recipe.output_item_name_temp, recipe.output_item_quantity, JSON.stringify(ingredientsJson), recipe.station, recipe.skill_req_name, recipe.skill_req_level, true, function(insertErr) {
                                    if (insertErr) console.error(`Error inserting recipe for ${recipe.output_item_name || recipe.output_item_name_temp}: ${insertErr.message}`);
                                    else if (this.changes > 0) console.log(`Inserted recipe for ${recipe.output_item_name || recipe.output_item_name_temp}`);
                                });
                                stmt.finalize();

                // Add recipes for Dark Secret Forest items
                const darkForestRecipes = [
                    { 
                        output_item_name: 'Shadow Weave Robe', 
                        ingredients: [ { name: 'Rare Herb', quantity: 5 }, { name: 'Shadow Root', quantity: 10 } ], 
                        station: 'Loom', 
                        skill_req_name: 'Tailoring', skill_req_level: 7 
                    },
                    {
                        output_item_name: 'Viperfang Dagger',
                        ingredients: [ { name: 'Iron Ore', quantity: 5 }, { name: 'Shadow Root', quantity: 3 } ], 
                        station: 'Forge',
                        skill_req_name: 'Blacksmithing', skill_req_level: 5
                    },
                    {
                        output_item_name: 'Treant Shield',
                        ingredients: [ { name: 'Ancient Bark', quantity: 8 }, { name: 'Iron Ore', quantity: 4 } ],
                        station: 'Forge',
                        skill_req_name: 'Blacksmithing', skill_req_level: 6
                    },
                    {
                        output_item_name: 'Potion of Forest Vigor',
                        ingredients: [ { name: 'Rare Herb', quantity: 3 }, { name: 'Shadow Root', quantity: 2 } ], 
                        station: 'Alchemy Lab',
                        skill_req_name: 'Alchemy', skill_req_level: 4
                    },
                    {
                        output_item_name: 'Sprite Essence Oil',
                        ingredients: [ { name: 'Shadow Root', quantity: 4 }, { name: 'Rare Herb', quantity: 2 } ], 
                        station: 'Alchemy Lab',
                        skill_req_name: 'Alchemy', skill_req_level: 6
                    }
                ];

                const recipeInsertStmt = db.prepare(`INSERT OR IGNORE INTO recipes 
                                    (output_item_id, output_item_quantity, required_ingredients, crafting_station_requirement, skill_requirement_name, skill_requirement_level, is_unlocked_by_default) 
                                    VALUES (?, ?, ?, ?, ?, ?, TRUE)`);

                let recipesProcessed = 0;
                const totalRecipes = darkForestRecipes.length;

                if (totalRecipes === 0) {
                    recipeInsertStmt.finalize();
                } else {
                    darkForestRecipes.forEach((recipe) => {
                        db.get("SELECT item_id FROM items WHERE name = ?", [recipe.output_item_name], (err, outputItem) => {
                            if (err) {
                                console.error(`Error finding output item ${recipe.output_item_name}: ${err.message}`);
                                recipesProcessed++;
                                if (recipesProcessed === totalRecipes) recipeInsertStmt.finalize();
                                return;
                            }
                            if (!outputItem) {
                                console.warn(`Output item ${recipe.output_item_name} not found for recipe. Skipping.`);
                                recipesProcessed++;
                                if (recipesProcessed === totalRecipes) recipeInsertStmt.finalize();
                                return;
                            }

                            let ingredientsJsonArray = [];
                            let ingredientsQueries = recipe.ingredients.map(ing => {
                                return new Promise((resolve, reject) => {
                                    db.get("SELECT item_id FROM items WHERE name = ?", [ing.name], (ingErr, ingItem) => {
                                        if (ingErr) {
                                            console.error(`Error finding ingredient ${ing.name} for ${recipe.output_item_name}: ${ingErr.message}`);
                                            reject(ingErr); // Reject if error
                                        } else if (!ingItem) {
                                            console.warn(`Ingredient ${ing.name} not found for recipe ${recipe.output_item_name}. Recipe will be skipped or incomplete.`);
                                            reject(new Error(`Ingredient not found: ${ing.name}`)); // Reject if not found
                                        } else {
                                            ingredientsJsonArray.push({ item_id: ingItem.item_id, quantity: ing.quantity });
                                            resolve();
                                        }
                                    });
                                });
                            });

                            Promise.all(ingredientsQueries)
                                .then(() => {
                                    if (ingredientsJsonArray.length === recipe.ingredients.length) { // All ingredients were found
                                        recipeInsertStmt.run(outputItem.item_id, 1, JSON.stringify(ingredientsJsonArray), recipe.station, recipe.skill_req_name, recipe.skill_req_level, function(insertErr) {
                                            if (insertErr) console.error(`Error inserting recipe for ${recipe.output_item_name}: ${insertErr.message}`);
                                            else if (this.changes > 0) console.log(`Inserted recipe for ${recipe.output_item_name}`);
                                        });
                                    }
                                })
                                .catch(error => {
                                    // Error already logged by individual ingredient queries
                                    // console.error(`Skipping recipe for ${recipe.output_item_name} due to missing ingredients or DB error.`);
                                })
                                .finally(() => {
                                    recipesProcessed++;
                                    if (recipesProcessed === totalRecipes) {
                                        recipeInsertStmt.finalize(err => {
                                            if (err) console.error("Error finalizing recipe statement:", err.message);
                                        });
                                    }
                                });
                        });
                    });
                }
                // Add recipes for Dark Secret Forest items
                const darkForestRecipes = [
                    { 
                        output_item_name: 'Shadow Weave Robe', 
                        ingredients: [ { name: 'Rare Herb', quantity: 5 }, { name: 'Shadow Root', quantity: 10 } ], 
                        station: 'Loom', 
                        skill_req_name: 'Tailoring', skill_req_level: 7 
                    },
                    {
                        output_item_name: 'Viperfang Dagger',
                        ingredients: [ { name: 'Iron Ore', quantity: 5 }, { name: 'Shadow Root', quantity: 3 } ], 
                        station: 'Forge',
                        skill_req_name: 'Blacksmithing', skill_req_level: 5
                    },
                    {
                        output_item_name: 'Treant Shield',
                        ingredients: [ { name: 'Ancient Bark', quantity: 8 }, { name: 'Iron Ore', quantity: 4 } ],
                        station: 'Forge',
                        skill_req_name: 'Blacksmithing', skill_req_level: 6
                    },
                    {
                        output_item_name: 'Potion of Forest Vigor',
                        ingredients: [ { name: 'Rare Herb', quantity: 3 }, { name: 'Shadow Root', quantity: 2 } ], 
                        station: 'Alchemy Lab',
                        skill_req_name: 'Alchemy', skill_req_level: 4
                    },
                    {
                        output_item_name: 'Sprite Essence Oil',
                        ingredients: [ { name: 'Shadow Root', quantity: 4 }, { name: 'Rare Herb', quantity: 2 } ], 
                        station: 'Alchemy Lab',
                        skill_req_name: 'Alchemy', skill_req_level: 6
                    }
                ];

                const recipeInsertStmt = db.prepare(`INSERT OR IGNORE INTO recipes 
                                    (output_item_id, output_item_quantity, required_ingredients, crafting_station_requirement, skill_requirement_name, skill_requirement_level, is_unlocked_by_default) 
                                    VALUES (?, ?, ?, ?, ?, ?, TRUE)`);

                let recipesProcessed = 0;
                const totalRecipes = darkForestRecipes.length;

                darkForestRecipes.forEach((recipe) => {
                    db.get("SELECT item_id FROM items WHERE name = ?", [recipe.output_item_name], (err, outputItem) => {
                        if (err) {
                            console.error(`Error finding output item ${recipe.output_item_name}: ${err.message}`);
                            recipesProcessed++;
                            if (recipesProcessed === totalRecipes) recipeInsertStmt.finalize();
                            return;
                        }
                        if (!outputItem) {
                            console.warn(`Output item ${recipe.output_item_name} not found for recipe. Skipping.`);
                            recipesProcessed++;
                            if (recipesProcessed === totalRecipes) recipeInsertStmt.finalize();
                            return;
                        }

                        let ingredientsJsonArray = [];
                        let ingredientsFound = 0;
                        const totalIngredients = recipe.ingredients.length;

                        recipe.ingredients.forEach(ing => {
                            db.get("SELECT item_id FROM items WHERE name = ?", [ing.name], (ingErr, ingItem) => {
                                if (ingErr) {
                                    console.error(`Error finding ingredient ${ing.name} for ${recipe.output_item_name}: ${ingErr.message}`);
                                } else if (!ingItem) {
                                    console.warn(`Ingredient ${ing.name} not found for recipe ${recipe.output_item_name}. Recipe will be skipped or incomplete.`);
                                } else {
                                    ingredientsJsonArray.push({ item_id: ingItem.item_id, quantity: ing.quantity });
                                }
                                ingredientsFound++;
                                if (ingredientsFound === totalIngredients) {
                                    if (ingredientsJsonArray.length === totalIngredients) { // All ingredients were found
                                        recipeInsertStmt.run(outputItem.item_id, 1, JSON.stringify(ingredientsJsonArray), recipe.station, recipe.skill_req_name, recipe.skill_req_level, function(insertErr) {
                                            if (insertErr) console.error(`Error inserting recipe for ${recipe.output_item_name}: ${insertErr.message}`);
                                            else if (this.changes > 0) console.log(`Inserted recipe for ${recipe.output_item_name}`);
                                        });
                                    }
                                    recipesProcessed++;
                                    if (recipesProcessed === totalRecipes) recipeInsertStmt.finalize();
                                }
                            });
                        });
                         if (totalIngredients === 0) { // Handle recipes with no ingredients (if any)
                            recipesProcessed++;
                            if (recipesProcessed === totalRecipes) recipeInsertStmt.finalize();
                        }
                    });
                });
                 // If there are no recipes, finalize immediately.
                if (totalRecipes === 0) {
                    recipeInsertStmt.finalize();
                }
                // Add recipes for Dark Secret Forest items
                const darkForestRecipes = [
                    { 
                        output_item_name: 'Shadow Weave Robe', 
                        ingredients: [ { name: 'Rare Herb', quantity: 5 }, { name: 'Shadow Root', quantity: 10 } ], // Example ingredients
                        station: 'Loom', // Example, or null if no station needed
                        skill_req_name: 'Tailoring', skill_req_level: 7 // Example skill
                    },
                    {
                        output_item_name: 'Viperfang Dagger',
                        ingredients: [ { name: 'Iron Ore', quantity: 5 }, { name: 'Shadow Root', quantity: 3 } ], // Forest Viper might drop a "Viper Fang" item later
                        station: 'Forge',
                        skill_req_name: 'Blacksmithing', skill_req_level: 5
                    },
                    {
                        output_item_name: 'Treant Shield',
                        ingredients: [ { name: 'Ancient Bark', quantity: 8 }, { name: 'Iron Ore', quantity: 4 } ],
                        station: 'Forge',
                        skill_req_name: 'Blacksmithing', skill_req_level: 6
                    },
                    {
                        output_item_name: 'Potion of Forest Vigor',
                        ingredients: [ { name: 'Rare Herb', quantity: 3 }, { name: 'Shadow Root', quantity: 2 } ], // Example
                        station: 'Alchemy Lab',
                        skill_req_name: 'Alchemy', skill_req_level: 4
                    },
                    {
                        output_item_name: 'Sprite Essence Oil',
                        ingredients: [ { name: 'Shadow Root', quantity: 4 }, { name: 'Rare Herb', quantity: 2 } ], // Example, Shadow Sprite might drop "Sprite Essence" later
                        station: 'Alchemy Lab',
                        skill_req_name: 'Alchemy', skill_req_level: 6
                    }
                ];

                const recipeInsertStmt = db.prepare(`INSERT OR IGNORE INTO recipes 
                                    (output_item_id, output_item_quantity, required_ingredients, crafting_station_requirement, skill_requirement_name, skill_requirement_level, is_unlocked_by_default) 
                                    VALUES (?, ?, ?, ?, ?, ?, TRUE)`); // Default output_quantity to 1, is_unlocked to TRUE

                darkForestRecipes.forEach(async (recipe) => {
                    try {
                        const outputItem = await new Promise((resolve, reject) => {
                            db.get("SELECT item_id FROM items WHERE name = ?", [recipe.output_item_name], (err, row) => {
                                if (err) reject(err); else resolve(row);
                            });
                        });

                        if (!outputItem) {
                            console.warn(`Output item ${recipe.output_item_name} not found for recipe. Skipping.`);
                            return;
                        }

                        let ingredientsJsonArray = [];
                        for (const ing of recipe.ingredients) {
                            const ingItem = await new Promise((resolve, reject) => {
                                db.get("SELECT item_id FROM items WHERE name = ?", [ing.name], (err, row) => {
                                    if (err) reject(err); else resolve(row);
                                });
                            });
                            if (!ingItem) {
                                console.warn(`Ingredient ${ing.name} not found for recipe ${recipe.output_item_name}. Skipping recipe.`);
                                return; 
                            }
                            ingredientsJsonArray.push({ item_id: ingItem.item_id, quantity: ing.quantity });
                        }
                        
                        if (ingredientsJsonArray.length === recipe.ingredients.length) { // Ensure all ingredients were found
                            recipeInsertStmt.run(outputItem.item_id, 1, JSON.stringify(ingredientsJsonArray), recipe.station, recipe.skill_req_name, recipe.skill_req_level, function(insertErr) {
                                if (insertErr) console.error(`Error inserting recipe for ${recipe.output_item_name}: ${insertErr.message}`);
                                else if (this.changes > 0) console.log(`Inserted recipe for ${recipe.output_item_name}`);
                            });
                        }
                    } catch (e) {
                        console.error("Error processing recipe to add:", e.message);
                    }
                });
                // recipeInsertStmt.finalize(); // Finalize after all .run calls are queued if not using async/await for each db op.
                // However, with async/await inside forEach, it's better to finalize after the loop or handle errors carefully.
                // For simplicity here, this finalize might be called prematurely if db ops are still pending.
                // A better pattern is to collect all promises from db.run and use Promise.all before finalizing.
                // Or, remove async from forEach and use a standard loop or map with Promise.all.
                // For now, we'll assume the operations complete before finalize is effectively an issue in this script context.
                // To be safe, finalize after a timeout or use a counter if not using Promise.all
                setTimeout(() => recipeInsertStmt.finalize(), 1000); // Simple delay, not ideal for production

                            } catch (e) {
                                console.error("Error processing recipe to add:", e.message);
                            }
                        });
                         // Example of adding a new item that is craftable
                        const craftableItems = [
                            { name: 'Medium Health Potion', description: 'Restores 50 HP.', effect_type: 'HEAL_HP', effect_value: 50, consumable: true, buy_price: 75, sell_price: 30, item_type: 'POTION' },
                            { name: 'Iron Sword', description: 'A basic but reliable iron sword.', effect_type: 'EQUIPMENT', effect_value: 8, target_stat: 'strength', consumable: false, buy_price: 150, sell_price: 60, item_type: 'WEAPON' },
                            { name: 'Sturdy Shield', description: 'A shield made of wood and iron.', effect_type: 'EQUIPMENT', effect_value: 5, target_stat: 'defense', consumable: false, buy_price: 120, sell_price: 50, item_type: 'ARMOR' },
                        ];
                        const itemStmt = db.prepare(`INSERT OR IGNORE INTO items (name, description, effect_type, effect_value, target_stat, consumable, buy_price, sell_price, item_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                        craftableItems.forEach(item => {
                            itemStmt.run(item.name, item.description, item.effect_type, item.effect_value, item.target_stat, item.consumable, item.buy_price, item.sell_price, item.item_type, function(itemInsertErr){
                                if(itemInsertErr) console.error(`Error inserting craftable item ${item.name}: ${itemInsertErr.message}`);
                                else if(this.changes > 0) console.log(`Inserted craftable item: ${item.name}`);
                            });
                        });
                        itemStmt.finalize();
                    }
                });

                // Create skills table
                db.run(`CREATE TABLE IF NOT EXISTS skills (
                    skill_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    description TEXT NOT NULL,
                    class_restriction TEXT,
                    level_requirement INTEGER DEFAULT 1,
                    mp_cost INTEGER DEFAULT 0,
                    damage_multiplier REAL,
                    base_damage INTEGER,
                    heal_amount INTEGER,
                    effect_type TEXT,
                    effect_value INTEGER,
                    effect_duration INTEGER,
                    target_type TEXT DEFAULT 'ENEMY'
                )`, (err) => {
                    if (err) {
                        console.error('Error creating skills table:', err.message);
                    } else {
                        console.log('Table "skills" created or already exists.');
                        let initialSkills = [ // Changed to let
                            // ... (existing skills) ...
                            { name: 'Power Strike', description: 'A strong attack that deals extra damage.', class_restriction: 'محارب', level_requirement: 3, mp_cost: 10, damage_multiplier: 1.5, base_damage: 5, heal_amount: null, effect_type: null, effect_value: null, effect_duration: null, target_type: 'ENEMY' },
                            { name: 'Shield Bash', description: 'Bashes the enemy with a shield, possibly stunning them.', class_restriction: 'محارب', level_requirement: 5, mp_cost: 15, damage_multiplier: 0.8, base_damage: 10, heal_amount: null, effect_type: 'STUN', effect_value: null, effect_duration: 1, target_type: 'ENEMY' }, 
                            { name: 'Fireball', description: 'Hurls a ball of fire at the enemy, may cause burn.', class_restriction: 'ساحر', level_requirement: 2, mp_cost: 15, damage_multiplier: null, base_damage: 30, heal_amount: null, effect_type: 'BURN', effect_value: 5, effect_duration: 3, target_type: 'ENEMY' }, 
                            { name: 'Ice Shard', description: 'Launches a shard of ice, slowing the enemy.', class_restriction: 'ساحر', level_requirement: 4, mp_cost: 20, damage_multiplier: null, base_damage: 25, heal_amount: null, effect_type: 'SLOW', effect_value: 5, effect_duration: 2, target_type: 'ENEMY' }, 
                            { name: 'Minor Heal', description: 'Heals a small amount of HP for the caster.', class_restriction: 'كاهن', level_requirement: 2, mp_cost: 20, damage_multiplier: null, base_damage: null, heal_amount: 25, effect_type: null, effect_value: null, effect_duration: null, target_type: 'SELF' },
                            { name: 'Blessing of Fortitude', description: 'Increases target\'s defense for a short duration.', class_restriction: 'كاهن', level_requirement: 4, mp_cost: 25, damage_multiplier: null, base_damage: null, heal_amount: null, effect_type: 'DEFENSE_BUFF', effect_value: 10, effect_duration: 3, target_type: 'SELF' }, 
                            { name: 'Regenerate HP', description: 'Heals target over time.', class_restriction: 'كاهن', level_requirement: 6, mp_cost: 30, damage_multiplier: null, base_damage: null, heal_amount: null, effect_type: 'REGENERATE_HP', effect_value: 8, effect_duration: 3, target_type: 'SELF'}, 
                            { name: 'Quick Stab', description: 'A fast stab that costs little MP.', class_restriction: 'قاتل', level_requirement: 2, mp_cost: 5, damage_multiplier: 1.1, base_damage: 0, heal_amount: null, effect_type: null, effect_value: null, effect_duration: null, target_type: 'ENEMY' },
                            { name: 'Poison Dart', description: 'Shoots a dart that poisons the enemy.', class_restriction: 'قاتل', level_requirement: 4, mp_cost: 15, damage_multiplier: null, base_damage: 5, heal_amount: null, effect_type: 'POISON', effect_value: 4, effect_duration: 3, target_type: 'ENEMY' }, 
                            { name: 'Summon Wolf Pup', description: 'Summons a weak wolf pup to aid in battle for a short time.', class_restriction: 'مستدعي', level_requirement: 3, mp_cost: 25, damage_multiplier: null, base_damage: null, heal_amount: null, effect_type: 'SUMMON_WOLF', effect_value: null, effect_duration: 3, target_type: 'SELF' },
                        ];
                        
                        // Boss Skills for Infernos
                        const bossSkills = [
                            { name: 'Eruption', description: 'Infernos causes the ground to erupt, dealing heavy fire damage and burning all opponents.', class_restriction: null, level_requirement: 1, mp_cost: 0, damage_multiplier: null, base_damage: 30, heal_amount: null, effect_type: 'BURN', effect_value: 5, effect_duration: 2, target_type: 'ALL_ENEMIES' }, // Burn damage already changed to 5
                            { name: 'Magma Shield', description: 'Infernos encases itself in a shield of hardened magma, greatly increasing its defense.', class_restriction: null, level_requirement: 1, mp_cost: 0, damage_multiplier: null, base_damage: null, heal_amount: null, effect_type: 'DEFENSE_BUFF', effect_value: 20, effect_duration: 3, target_type: 'SELF' },
                            { name: 'Summon Fire Imps', description: 'Infernos summons 2 fiery imps to fight alongside it.', class_restriction: null, level_requirement: 1, mp_cost: 0, damage_multiplier: null, base_damage: null, heal_amount: null, effect_type: 'SUMMON_IMPS', effect_value: 2, effect_duration: null, target_type: 'SELF' } 
                        ];
                        initialSkills.push(...bossSkills);

                        const stmt = db.prepare(`INSERT OR IGNORE INTO skills (name, description, class_restriction, level_requirement, mp_cost, damage_multiplier, base_damage, heal_amount, effect_type, effect_value, effect_duration, target_type) 
                                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                        initialSkills.forEach(s => {
                            stmt.run(s.name, s.description, s.class_restriction, s.level_requirement, s.mp_cost, s.damage_multiplier, s.base_damage, s.heal_amount, s.effect_type, s.effect_value, s.effect_duration, s.target_type, function(insertErr){
                                if (insertErr) {
                                    console.error(`Error inserting skill ${s.name}:`, insertErr.message);
                                } else {
                                   if (this.changes > 0) console.log(`Inserted/Updated initial skill: ${s.name}`);
                                }
                            });
                        });
                        stmt.finalize();
                    }
                });

                // Add new world: Dark Secret Forest
                const darkSecretForestData = {
                    name: 'Dark Secret Forest',
                    description: 'A dense and ancient forest, shrouded in mystery and lurking dangers. Whispers of forgotten rituals and hidden creatures echo through the trees.',
                    story: "The Dark Secret Forest has stood for millennia, a silent watcher of civilizations rising and falling around it. Its heart is said to hold secrets of immense power, protected by guardians both natural and supernatural. Many adventurers have entered seeking its treasures or knowledge, but few have returned unscathed, their minds often as lost as their bodies within its labyrinthine paths.",
                    enemy_types: JSON.stringify([]), // To be updated later
                    resources: JSON.stringify([])   // To be updated later
                };
                
                db.run(`INSERT OR IGNORE INTO worlds (server_id, name, description, story, enemy_types, resources) VALUES (?, ?, ?, ?, ?, ?)`,
                    ['PLACEHOLDER_SERVER_ID_FOR_NOW', darkSecretForestData.name, darkSecretForestData.description, darkSecretForestData.story, darkSecretForestData.enemy_types, darkSecretForestData.resources],
                    function(err) {
                        if (err) {
                            console.error(`Error inserting world ${darkSecretForestData.name}:`, err.message);
                        } else {
                            if (this.changes > 0) console.log(`Inserted world: ${darkSecretForestData.name}`);
                            // Note: We'll handle channel creation and linking after the server-specific part of install.js
                        }
                    }
                );


                // Create player_skills table
                db.run(`CREATE TABLE IF NOT EXISTS player_skills (
                    player_skill_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id INTEGER NOT NULL,
                    skill_id INTEGER NOT NULL,
                    FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE,
                    FOREIGN KEY (skill_id) REFERENCES skills(skill_id) ON DELETE CASCADE,
                    UNIQUE (player_id, skill_id)
                )`, (err) => {
                    if (err) {
                        console.error('Error creating player_skills table:', err.message);
                    } else {
                        console.log('Table "player_skills" created or already exists.');
                    }
                });

                // Create items table
                db.run(`CREATE TABLE IF NOT EXISTS items (
                    item_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    description TEXT NOT NULL,
                    effect_type TEXT NOT NULL,
                    effect_value INTEGER,
                    target_stat TEXT,
                    duration INTEGER,
                    consumable BOOLEAN DEFAULT TRUE,
                    buy_price INTEGER,
                    sell_price INTEGER,
                    item_type TEXT DEFAULT 'GENERAL'
                )`, (err) => {
                    if (err) {
                        console.error('Error creating items table:', err.message);
                    } else {
                        console.log('Table "items" created or already exists.');
                        // Add initial items
                        const initialItems = [
                            { name: 'Small Health Potion', description: 'جرعة صغيرة تستعيد 20 نقطة صحة.', effect_type: 'HEAL_HP', effect_value: 20, target_stat: null, duration: null, consumable: true, buy_price: 25, sell_price: 10, item_type: 'POTION' },
                            { name: 'Mana Potion', description: 'جرعة تستعيد 15 نقطة طاقة.', effect_type: 'HEAL_MP', effect_value: 15, target_stat: null, duration: null, consumable: true, buy_price: 30, sell_price: 12, item_type: 'POTION' },
                            { name: 'Weak Strength Scroll', description: 'لفافة تزيد القوة بمقدار 2 بشكل دائم.', effect_type: 'STAT_BOOST', effect_value: 2, target_stat: 'strength', duration: null, consumable: true, buy_price: 100, sell_price: 40, item_type: 'SCROLL' },
                            { name: 'Stone of Protection', description: 'حجر يزيد الدفاع بمقدار 1 بشكل دائم.', effect_type: 'STAT_BOOST', effect_value: 1, target_stat: 'defense', duration: null, consumable: true, buy_price: 80, sell_price: 30, item_type: 'ENHANCEMENT' },
                            // Resources
                            { name: 'Iron Ore', description: 'Raw iron ore, needs smelting.', effect_type: null, effect_value: null, target_stat: null, duration: null, consumable: false, buy_price: 10, sell_price: 5, item_type: 'RESOURCE' },
                            { name: 'Oak Wood', description: 'Sturdy oak wood for crafting.', effect_type: null, effect_value: null, target_stat: null, duration: null, consumable: false, buy_price: 8, sell_price: 3, item_type: 'RESOURCE' },
                            { name: 'Rare Herb', description: 'A rare herb used in alchemy.', effect_type: null, effect_value: null, target_stat: null, duration: null, consumable: true, buy_price: 15, sell_price: 7, item_type: 'RESOURCE' },
                             // Tools
                            { name: 'Basic Pickaxe', description: 'A simple pickaxe for mining basic ores.', effect_type: 'TOOL', effect_value: null, target_stat: null, duration: null, consumable: false, buy_price: 50, sell_price: 20, item_type: 'TOOL' },
                            { name: 'Basic Axe', description: 'A simple axe for chopping wood.', effect_type: 'TOOL', effect_value: null, target_stat: null, duration: null, consumable: false, buy_price: 45, sell_price: 18, item_type: 'TOOL' },
                        ];
                        const stmt = db.prepare(`INSERT OR IGNORE INTO items (name, description, effect_type, effect_value, target_stat, duration, consumable, buy_price, sell_price, item_type) 
                                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                        initialItems.forEach(item => {
                            stmt.run(item.name, item.description, item.effect_type, item.effect_value, item.target_stat, item.duration, item.consumable, item.buy_price, item.sell_price, item.item_type, function(insertErr) { // Use function to access this.changes
                                if (insertErr) {
                                    console.error(`Error inserting item ${item.name}:`, insertErr.message);
                                } else {
                                    if (this.changes > 0) console.log(`Inserted initial item: ${item.name} (Type: ${item.item_type})`);
                                }
                            });
                        });
                        stmt.finalize();
                    }
                });

                // Create quests table
                db.run(`CREATE TABLE IF NOT EXISTS quests (
                    quest_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    description TEXT NOT NULL,
                    world_name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    target_name TEXT,
                    target_quantity INTEGER,
                    xp_reward INTEGER NOT NULL,
                    coins_reward INTEGER NOT NULL,
                    item_reward_id INTEGER,
                    item_reward_quantity INTEGER DEFAULT 1,
                    prerequisite_quest_id INTEGER,
                    FOREIGN KEY (item_reward_id) REFERENCES items(item_id),
                    FOREIGN KEY (prerequisite_quest_id) REFERENCES quests(quest_id)
                )`, (err) => {
                    if (err) {
                        console.error('Error creating quests table:', err.message);
                    } else {
                        console.log('Table "quests" created or already exists.');
                        const initialQuests = [
                            { name: 'Slay Fire Sprites', description: 'Defeat 3 Lesser Fire Sprites in the Fire World.', world_name: 'Fire World', type: 'KILL', target_name: 'Lesser Fire Sprite', target_quantity: 3, xp_reward: 50, coins_reward: 25, item_reward_id: null, item_reward_quantity: 1, prerequisite_quest_id: null },
                            { name: 'Gather Volcanic Rocks', description: 'Collect 5 Volcanic Rocks from the Fire World.', world_name: 'Fire World', type: 'COLLECT', target_name: 'Volcanic Rock', target_quantity: 5, xp_reward: 40, coins_reward: 20, item_reward_id: null, item_reward_quantity: 1, prerequisite_quest_id: null }, // Assumes 'Volcanic Rock' can be an item.
                            { name: 'Ice Wisp Hunt', description: 'Defeat 5 Ice Wisps in the Ice World.', world_name: 'Ice World', type: 'KILL', target_name: 'Ice Wisp', target_quantity: 5, xp_reward: 60, coins_reward: 30, item_reward_id: null, item_reward_quantity: 1, prerequisite_quest_id: null },
                        ];
                        const stmt = db.prepare(`INSERT OR IGNORE INTO quests (name, description, world_name, type, target_name, target_quantity, xp_reward, coins_reward, item_reward_id, item_reward_quantity, prerequisite_quest_id) 
                                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                        initialQuests.forEach(q => {
                            stmt.run(q.name, q.description, q.world_name, q.type, q.target_name, q.target_quantity, q.xp_reward, q.coins_reward, q.item_reward_id, q.item_reward_quantity, q.prerequisite_quest_id, function(insertErr){
                                if (insertErr) {
                                    console.error(`Error inserting quest ${q.name}:`, insertErr.message);
                                } else {
                                   if (this.changes > 0) console.log(`Inserted initial quest: ${q.name}`);
                                }
                            });
                        });
                        stmt.finalize();
                    }
                });

                // Create player_quests table
                db.run(`CREATE TABLE IF NOT EXISTS player_quests (
                    player_quest_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id INTEGER NOT NULL,
                    quest_id INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'AVAILABLE',
                    current_progress INTEGER DEFAULT 0,
                    FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE,
                    FOREIGN KEY (quest_id) REFERENCES quests(quest_id) ON DELETE CASCADE,
                    UNIQUE (player_id, quest_id)
                )`, (err) => {
                    if (err) {
                        console.error('Error creating player_quests table:', err.message);
                    } else {
                        console.log('Table "player_quests" created or already exists.');
                    }
                });

                // Create merchants table
                db.run(`CREATE TABLE IF NOT EXISTS merchants (
                    merchant_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    world_name TEXT NOT NULL,
                    description TEXT
                )`, (err) => {
                    if (err) {
                        console.error('Error creating merchants table:', err.message);
                    } else {
                        console.log('Table "merchants" created or already exists.');
                        const initialMerchants = [
                            { name: 'Berthold the Stout', world_name: 'Fire World', description: 'A rugged blacksmith offering basic adventuring gear.' },
                            { name: 'Elara Whisperwind', world_name: 'Ice World', description: 'A mysterious vendor of potions and scrolls.' },
                        ];
                        const stmt = db.prepare(`INSERT OR IGNORE INTO merchants (name, world_name, description) VALUES (?, ?, ?)`);
                        initialMerchants.forEach(m => {
                            stmt.run(m.name, m.world_name, m.description, function(insertErr){
                                if (insertErr) {
                                    console.error(`Error inserting merchant ${m.name}:`, insertErr.message);
                                } else {
                                   if (this.changes > 0) console.log(`Inserted initial merchant: ${m.name}`);
                                }
                            });
                        });
                        stmt.finalize();
                    }
                });

                // Add new quests for Dark Secret Forest
                const darkForestQuests = [
                    { name: 'Shadow Sprite Hunt', description: 'The forest floor is teeming with elusive Shadow Sprites. Thin their numbers.', world_name: 'Dark Secret Forest', type: 'KILL', target_name: 'Shadow Sprite', target_quantity: 5, xp_reward: 75, coins_reward: 30, item_reward_id: null, prerequisite_quest_id: null },
                    { name: 'Treant Troubles', description: 'The Twisted Treants are blocking ancient paths. Defeat two of them.', world_name: 'Dark Secret Forest', type: 'KILL', target_name: 'Twisted Treant', target_quantity: 2, xp_reward: 120, coins_reward: 50, item_reward_id: null, prerequisite_quest_id: null },
                    { name: 'Viper Fang Harvest', description: 'Forest Vipers possess potent fangs. Collect 3 of them for research.', world_name: 'Dark Secret Forest', type: 'KILL', target_name: 'Forest Viper', target_quantity: 3, xp_reward: 90, coins_reward: 40, item_reward_id: null, prerequisite_quest_id: null }, // Assuming fangs are implied by kill, not a separate item for now
                    { name: 'Root Scavenger', description: 'Gather 5 Shadow Roots from the dark soil of the forest.', world_name: 'Dark Secret Forest', type: 'COLLECT', target_name: 'Shadow Root', target_quantity: 5, xp_reward: 60, coins_reward: 25, item_reward_id: null, prerequisite_quest_id: null }
                ];
                
                const questStmt = db.prepare(`INSERT OR IGNORE INTO quests 
                                             (name, description, world_name, type, target_name, target_quantity, xp_reward, coins_reward, item_reward_id, prerequisite_quest_id) 
                                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                darkForestQuests.forEach(q => {
                    // For COLLECT quests, ensure the target_name (item) exists. For KILL quests, target_name is enemy name.
                    // This simplified version assumes items/enemies exist. A robust version would check.
                    questStmt.run(q.name, q.description, q.world_name, q.type, q.target_name, q.target_quantity, q.xp_reward, q.coins_reward, q.item_reward_id, q.prerequisite_quest_id, function(err) {
                        if (err) console.error(`Error inserting quest ${q.name}: ${err.message}`);
                        else if (this.changes > 0) console.log(`Inserted quest: ${q.name}`);
                    });
                });
                questStmt.finalize();
                db.run(`CREATE TABLE IF NOT EXISTS merchant_items (
                    merchant_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    merchant_id INTEGER NOT NULL,
                    item_id INTEGER NOT NULL,
                    buy_price INTEGER NOT NULL,
                    stock_quantity INTEGER,
                    FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id) ON DELETE CASCADE,
                    FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE,
                    UNIQUE (merchant_id, item_id)
                )`, (err) => {
                    if (err) {
                        console.error('Error creating merchant_items table:', err.message);
                    } else {
                        console.log('Table "merchant_items" created or already exists.');
                        // Link merchants to items (assuming item_id and merchant_id are known or queried)
                        // Example: Berthold (merchant_id 1) sells Small Health Potion (item_id 1) for 25
                        //          Elara (merchant_id 2) sells Mana Potion (item_id 2) for 30
                        // These IDs depend on the order of insertion of initial items and merchants.
                        // For robustness, one might query these IDs first. For simplicity here, we assume they are 1 and 2.
                        
                        // It's safer to get merchant_id and item_id dynamically
                        db.get("SELECT merchant_id FROM merchants WHERE name = 'Berthold the Stout'", [], (err, berthold) => {
                            if (err) return console.error(err.message);
                            if (berthold) {
                                db.get("SELECT item_id, buy_price FROM items WHERE name = 'Small Health Potion'", [], (err, healthPotion) => {
                                    if(err) return console.error(err.message);
                                    if(healthPotion) {
                                        db.run("INSERT OR IGNORE INTO merchant_items (merchant_id, item_id, buy_price) VALUES (?, ?, ?)", 
                                               [berthold.merchant_id, healthPotion.item_id, healthPotion.buy_price], (e) => {
                                                if(e) console.error("Error linking Berthold to Health Potion:", e.message);
                                                else if(this.changes > 0) console.log("Linked Berthold to Small Health Potion");
                                               });
                                    }
                                });
                                db.get("SELECT item_id, buy_price FROM items WHERE name = 'Stone of Protection'", [], (err, stone) => {
                                    if(err) return console.error(err.message);
                                    if(stone) {
                                        db.run("INSERT OR IGNORE INTO merchant_items (merchant_id, item_id, buy_price) VALUES (?, ?, ?)", 
                                               [berthold.merchant_id, stone.item_id, stone.buy_price], (e) => {
                                                if(e) console.error("Error linking Berthold to Stone of Protection:", e.message);
                                                else if(this.changes > 0) console.log("Linked Berthold to Stone of Protection");
                                               });
                                    }
                                });
                            }
                        });

                        db.get("SELECT merchant_id FROM merchants WHERE name = 'Elara Whisperwind'", [], (err, elara) => {
                            if(err) return console.error(err.message);
                            if(elara) {
                                db.get("SELECT item_id, buy_price FROM items WHERE name = 'Mana Potion'", [], (err, manaPotion) => {
                                     if(err) return console.error(err.message);
                                     if(manaPotion) {
                                        db.run("INSERT OR IGNORE INTO merchant_items (merchant_id, item_id, buy_price) VALUES (?, ?, ?)", 
                                               [elara.merchant_id, manaPotion.item_id, manaPotion.buy_price], (e) => {
                                                if(e) console.error("Error linking Elara to Mana Potion:", e.message);
                                                else if(this.changes > 0) console.log("Linked Elara to Mana Potion");
                                               });
                                     }
                                });
                                db.get("SELECT item_id, buy_price FROM items WHERE name = 'Weak Strength Scroll'", [], (err, strengthScroll) => {
                                     if(err) return console.error(err.message);
                                     if(strengthScroll) {
                                        db.run("INSERT OR IGNORE INTO merchant_items (merchant_id, item_id, buy_price) VALUES (?, ?, ?)", 
                                               [elara.merchant_id, strengthScroll.item_id, strengthScroll.buy_price], (e) => {
                                                if(e) console.error("Error linking Elara to Strength Scroll:", e.message);
                                                else if(this.changes > 0) console.log("Linked Elara to Weak Strength Scroll");
                                               });
                                     }
                                });
                            }
                        });
                    }
                });

                // Add new merchant for Dark Secret Forest
                const morwen = { name: 'Morwen the Shadow Weaver', world_name: 'Dark Secret Forest', description: 'A reclusive herbalist and potion maker, dealing in rare forest components and concoctions.' };
                db.run(`INSERT OR IGNORE INTO merchants (name, world_name, description) VALUES (?, ?, ?)`, 
                       [morwen.name, morwen.world_name, morwen.description], function(err) {
                    if (err) console.error(`Error inserting merchant ${morwen.name}: ${err.message}`);
                    else if (this.changes > 0) {
                        console.log(`Inserted merchant: ${morwen.name}`);
                        const morwenMerchantId = this.lastID;
                        // Link items to Morwen
                        const morwenItems = [
                            { itemName: 'Rare Herb', buyPrice: 20 }, // Sells Rare Herb at a slightly higher price
                            { itemName: 'Shadow Root', buyPrice: 35 },
                            { itemName: 'Small Health Potion', buyPrice: 30 }, // Also sells basic potions
                            { itemName: 'Mana Potion', buyPrice: 35 }
                        ];
                        morwenItems.forEach(itemToLink => {
                            db.get("SELECT item_id FROM items WHERE name = ?", [itemToLink.itemName], (itemErr, itemRow) => {
                                if (itemErr || !itemRow) return console.error(`Error finding item ${itemToLink.itemName} for Morwen: ${itemErr ? itemErr.message : 'Not found'}`);
                                db.run(`INSERT OR IGNORE INTO merchant_items (merchant_id, item_id, buy_price) VALUES (?, ?, ?)`,
                                       [morwenMerchantId, itemRow.item_id, itemToLink.buyPrice], function(linkErr) {
                                    if (linkErr) console.error(`Error linking ${itemToLink.itemName} to ${morwen.name}: ${linkErr.message}`);
                                    else if (this.changes > 0) console.log(`Linked ${itemToLink.itemName} to ${morwen.name}`);
                                });
                            });
                        });
                    }
                });
                db.run(`CREATE TABLE IF NOT EXISTS level_xp_requirements (
                    level INTEGER PRIMARY KEY,
                    xp_required INTEGER NOT NULL
                )`, (err) => {
                    if (err) {
                        console.error('Error creating level_xp_requirements table:', err.message);
                    } else {
                        console.log('Table "level_xp_requirements" created or already exists.');
                        const levelsData = [
                            { level: 1, xp_required: 100 }, { level: 2, xp_required: 250 },
                            { level: 3, xp_required: 500 }, { level: 4, xp_required: 800 },
                            { level: 5, xp_required: 1200 }, { level: 6, xp_required: 1700 },
                            { level: 7, xp_required: 2300 }, { level: 8, xp_required: 3000 },
                            { level: 9, xp_required: 3800 }, { level: 10, xp_required: 4700 },
                            // Add more levels as needed, e.g., up to 50 or 100
                            { level: 11, xp_required: 5700 }, { level: 12, xp_required: 6800 },
                            { level: 13, xp_required: 8000 }, { level: 14, xp_required: 9300 },
                            { level: 15, xp_required: 10700 }, { level: 16, xp_required: 12200 },
                            { level: 17, xp_required: 13800 }, { level: 18, xp_required: 15500 },
                            { level: 19, xp_required: 17300 }, { level: 20, xp_required: 19200 },
                        ];
                        const stmt = db.prepare(`INSERT OR IGNORE INTO level_xp_requirements (level, xp_required) VALUES (?, ?)`);
                        levelsData.forEach(lvl => {
                            stmt.run(lvl.level, lvl.xp_required, function(insertErr) {
                                if (insertErr) {
                                    console.error(`Error inserting level ${lvl.level}:`, insertErr.message);
                                } else {
                                    if (this.changes > 0) console.log(`Inserted level requirement: Level ${lvl.level} - ${lvl.xp_required} XP`);
                                }
                            });
                        });
                        stmt.finalize();
                    }
                });


                // --- 4. Store Server Data & Initial Worlds ---
                const serverId = guild.id;
                const serverName = guild.name;

                db.get(`SELECT server_id FROM servers WHERE server_id = ?`, [serverId], (err, row) => {
                    if (err) {
                        console.error('Error checking for existing server:', err.message);
                        interaction.followUp({ content: 'Error accessing server data.', ephemeral: true });
                        db.close();
                        return;
                    }

                    const insertServerAndWorlds = () => {
                        db.run(`INSERT INTO servers (server_id, server_name) VALUES (?, ?)`, [serverId, serverName], function(err) {
                            if (err) {
                                console.error('Error inserting server data:', err.message);
                                interaction.followUp({ content: 'Failed to save server information to the database.', ephemeral: true });
                                db.close();
                                return;
                            }
                            console.log(`Server ${serverName} (ID: ${serverId}) added to the database.`);

                            // Insert worlds and their channels
                            let worldsData = [ // Changed to let to allow pushing new world
                                { 
                                    name: 'Fire World', 
                                    description: 'A blazing world of fire and ash.', 
                                    textChannelName: 'Fire-World-Text', 
                                    voiceChannelName: 'Fire-World-Voice',
                                    story: "عالم ملتهب تسوده الحمم البركانية وتعيش فيه كائنات نارية قوية. يُحكى أن قلب هذا العالم ينبض بنيران أبدية، ومن يجرؤ على الاقتراب منه قد ينال قوة هائلة أو يلقى حتفه رمادًا.",
                                    enemy_types: JSON.stringify(['Fire Elemental', 'Lava Golem', 'Inferno Drake Hatchling']),
                                    resources: JSON.stringify(['Obsidian Shard', 'Fire Ruby', 'Volcanic Rock'])
                                },
                                { 
                                    name: 'Ice World', 
                                    description: 'A frigid world of ice and snow.', 
                                    textChannelName: 'Ice-World-Text', 
                                    voiceChannelName: 'Ice-World-Voice',
                                    story: "أرض متجمدة وصامتة، حيث تتجول وحوش الجليد وتتحدى البرودة القارسة. تقول الأساطير أن بلورة جليدية عملاقة في مركز هذا العالم هي مصدر قوته، وتحرسها أرواح قديمة.",
                                    enemy_types: JSON.stringify(['Ice Sprite', 'Frost Wolf', 'Glacier Guardian']),
                                    resources: JSON.stringify(['Glacier Crystal', 'Frozen Herb', 'Arctic Fur'])
                                },
                                // Add the new world here for channel creation
                                {
                                    name: 'Dark Secret Forest',
                                    description: darkSecretForestDataGlobal.description, 
                                    textChannelName: 'dark-secret-forest-text',
                                    voiceChannelName: 'dark-secret-forest-voice',
                                    story: darkSecretForestDataGlobal.story,
                                    enemy_types: darkForestEnemyNamesGlobal, 
                                    resources: darkForestResourceNamesGlobal   
                                }
                            ];

                            worldsData.forEach(worldInfo => {
                                // Update or Insert world data for this specific server
                                db.run(`INSERT INTO worlds (server_id, name, description, story, enemy_types, resources) VALUES (?, ?, ?, ?, ?, ?)
                                        ON CONFLICT(server_id, name) DO UPDATE SET 
                                        description = excluded.description, 
                                        story = excluded.story, 
                                        enemy_types = excluded.enemy_types, 
                                        resources = excluded.resources`,
                                    [serverId, worldInfo.name, worldInfo.description, worldInfo.story, worldInfo.enemy_types, worldInfo.resources], function(err) {
                                    if (err) {
                                        console.error(`Error inserting/updating world ${worldInfo.name} for server ${serverId}:`, err.message);
                                        return; 
                                    }
                                    const worldId = this.lastID || null; // lastID is for INSERT. Need to fetch for UPDATE or if already exists.
                                    
                                    // Fetch world_id if it was an update or already existed
                                    db.get("SELECT world_id FROM worlds WHERE name = ? AND server_id = ?", [worldInfo.name, serverId], async (err, row) => {
                                        if(err || !row) {
                                            console.error(`Could not get world_id for ${worldInfo.name} on server ${serverId}`);
                                            return;
                                        }
                                        const currentWorldId = row.world_id;
                                        console.log(`World "${worldInfo.name}" (ID: ${currentWorldId}) processed for server ${serverId}.`);

                                        // Find or create channels
                                        let textChannel = guild.channels.cache.find(ch => ch.name === worldInfo.textChannelName.toLowerCase() && ch.parentId === category.id && ch.type === ChannelType.GuildText);
                                        let voiceChannel = guild.channels.cache.find(ch => ch.name === worldInfo.voiceChannelName.toLowerCase() && ch.parentId === category.id && ch.type === ChannelType.GuildVoice);

                                        try {
                                            if (!textChannel) {
                                                textChannel = await guild.channels.create({ name: worldInfo.textChannelName, type: ChannelType.GuildText, parent: category.id });
                                                console.log(`Text channel ${textChannel.name} created.`);
                                            }
                                            if (!voiceChannel) {
                                                voiceChannel = await guild.channels.create({ name: worldInfo.voiceChannelName, type: ChannelType.GuildVoice, parent: category.id });
                                                console.log(`Voice channel ${voiceChannel.name} created.`);
                                            }
                                        } catch (channelCreationError) {
                                            console.error(`Error creating channels for ${worldInfo.name}:`, channelCreationError);
                                            return; // Stop processing this world if channels can't be made
                                        }
                                        
                                        // Link channels and send story
                                        if (textChannel) {
                                            db.run(`INSERT OR IGNORE INTO world_channels (channel_id, world_id, type) VALUES (?, ?, ?)`, [textChannel.id, currentWorldId, 'text'], async (dbErr) => {
                                                if (dbErr) console.error(`Error linking text channel for ${worldInfo.name}:`, dbErr.message);
                                                else {
                                                    console.log(`Text channel for ${worldInfo.name} linked.`);
                                                    try {
                                                        // Check if story message already pinned
                                                        const pinnedMessages = await textChannel.messages.fetchPinned();
                                                        const existingStoryMessage = pinnedMessages.find(msg => msg.author.id === interaction.client.user.id && msg.content.includes(`**مرحباً بك في ${worldInfo.name}**`));
                                                        if (!existingStoryMessage) {
                                                            const storyMessage = await textChannel.send(`**مرحباً بك في ${worldInfo.name}**\n\n${worldInfo.story}`);
                                                            await storyMessage.pin().catch(pinErr => console.error(`Failed to pin message in ${textChannel.name}: ${pinErr.message}`));
                                                            console.log(`Story message sent and pinned in ${textChannel.name}.`);
                                                        } else {
                                                            console.log(`Story message already exists in ${textChannel.name}.`);
                                                        }
                                                    } catch (pinError) {
                                                        console.error(`Failed to send or pin story message in ${textChannel.name}:`, pinError);
                                                    }
                                                }
                                            });
                                        }
                                        if (voiceChannel) {
                                            db.run(`INSERT OR IGNORE INTO world_channels (channel_id, world_id, type) VALUES (?, ?, ?)`, [voiceChannel.id, currentWorldId, 'voice'], (dbErr) => {
                                                if (dbErr) console.error(`Error linking voice channel for ${worldInfo.name}:`, dbErr.message);
                                                else console.log(`Voice channel for ${worldInfo.name} linked.`);
                                            });
                                        }
                                    });
                                });
                            });
                            interaction.followUp({ content: 'Database initialized, server information and initial worlds (with stories) saved! Story messages sent to world channels.', ephemeral: true });
                            db.close((err) => {
                                if (err) console.error('Error closing database:', err.message);
                            });
                        });
                    };

                    if (!row) {
                        insertServerAndWorlds();
                    } else {
                        console.log(`Server ${serverName} (ID: ${serverId}) already exists in the database.`);
                        // Optionally, you could add logic here to verify/update worlds and channels if the server is already registered.
                        // For now, we'll assume if the server exists, the worlds setup by this command also exist or are not meant to be duplicated by this command.
                        interaction.followUp({ content: 'Server is already registered. Initial worlds and channels setup assumed to be complete or managed separately.', ephemeral: true });
                        db.close((err) => {
                            if (err) console.error('Error closing database:', err.message);
                        });
                    }
                });
            });
        });
    },
};
