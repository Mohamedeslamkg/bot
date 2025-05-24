const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');

// Database path
const dbPath = path.join(__dirname, '..', 'data', 'shadow_realms.db');

// In-memory store for active battles
const activeBattles = {}; // Key: userId, Value: { player_effects: [], enemy_effects: [], enemy: {}, enemy_current_hp: X, worldName: "", playerData: {} }

// --- Status Effect Management ---
function applyEffectsToStats(baseStats, activeEffects) {
    const modifiedStats = { ...baseStats }; 
    if (!activeEffects) activeEffects = [];

    activeEffects.forEach(effect => {
        switch (effect.name) {
            case 'DEFENSE_BUFF':
                modifiedStats.defense = (modifiedStats.defense || 0) + (effect.value || 0);
                break;
            case 'ATTACK_BUFF':
                 modifiedStats.strength = (modifiedStats.strength || 0) + (effect.value || 0);
                 if (modifiedStats.hasOwnProperty('intelligence')) {
                    modifiedStats.intelligence = (modifiedStats.intelligence || 0) + (effect.value || 0);
                 }
                break;
            case 'ATTACK_DEBUFF': 
                modifiedStats.strength = Math.max(0, (modifiedStats.strength || 0) - (effect.value || 0));
                if (modifiedStats.hasOwnProperty('intelligence')) {
                    modifiedStats.intelligence = Math.max(0, (modifiedStats.intelligence || 0) - (effect.value || 0));
                }
                break;
            case 'SLOW': 
                modifiedStats.speed = Math.max(0, (modifiedStats.speed || 0) - (effect.value || 0));
                break;
        }
    });
    return modifiedStats;
}

async function processStatusEffects(targetType, battleState, db, battleLogArray) {
    const isPlayer = targetType === 'player';
    if (isPlayer && !battleState.playerData) {
        console.error("processStatusEffects: playerData is missing for player targetType.");
        battleLogArray.push("Error: Player data missing for status effects.");
        return { isStunned: false, isDefeated: false }; 
    }

    const targetEntity = isPlayer ? battleState.playerData : battleState.enemy;
    if (!targetEntity) {
        console.error(`processStatusEffects: targetEntity is null for targetType ${targetType}`);
        return { isStunned: false, isDefeated: false };
    }
    
    if (isPlayer && !battleState.player_effects) battleState.player_effects = [];
    if (!isPlayer && !battleState.enemy_effects) battleState.enemy_effects = [];
    
    const effectsArray = isPlayer ? battleState.player_effects : battleState.enemy_effects;
    const targetName = isPlayer ? battleState.playerData.name : battleState.enemy.name;
    let isStunnedThisTurn = false;
    let isDefeatedByDot = false;

    if (!effectsArray || effectsArray.length === 0) {
        return { isStunned: isStunnedThisTurn, isDefeated: isDefeatedByDot };
    }
    
    for (let i = effectsArray.length - 1; i >= 0; i--) {
        const effect = effectsArray[i];
        let effectAppliedMessage = "";

        switch (effect.name) {
            case 'BURN':
            case 'POISON':
                const dotDamage = effect.value || 0;
                if (isPlayer) battleState.playerData.hp -= dotDamage;
                else battleState.enemy_current_hp -= dotDamage;
                effectAppliedMessage = `🩸 ${targetName} took ${dotDamage} damage from ${effect.name}.`;
                break;
            case 'REGENERATE_HP':
                const classForHp = isPlayer && battleState.playerData && battleState.playerData.class ? battleState.playerData.class : 'محارب'; 
                const levelForHp = isPlayer && battleState.playerData && battleState.playerData.level ? battleState.playerData.level : 1; 
                const classDefaultHp = classForHp === 'محارب' ? 100 : (classForHp === 'ساحر' ? 80 : 90);
                const maxHp = isPlayer ? ((levelForHp * 10) + classDefaultHp) : battleState.enemy.hp;
                const healAmount = effect.value || 0;
                let actualHeal = 0;
                if (isPlayer) {
                    actualHeal = Math.min(healAmount, maxHp - battleState.playerData.hp);
                    if (actualHeal > 0) battleState.playerData.hp += actualHeal;
                } else {
                    actualHeal = Math.min(healAmount, battleState.enemy.hp - battleState.enemy_current_hp);
                    if (actualHeal > 0) battleState.enemy_current_hp += actualHeal;
                }
                if(actualHeal > 0) effectAppliedMessage = `💚 ${targetName} regenerated ${actualHeal} HP.`;
                break;
            case 'STUN':
                isStunnedThisTurn = true; 
                effectAppliedMessage = `😵 ${targetName} is stunned!`;
                break;
        }

        if (effectAppliedMessage) battleLogArray.push(effectAppliedMessage);

        effect.duration--;
        if (effect.duration <= 0) {
            battleLogArray.push(`✨ ${targetName} is no longer affected by ${effect.name} (from ${effect.source_skill_name || 'an unknown source'}).`);
            effectsArray.splice(i, 1);
        }
    }

    if (isPlayer && battleState.playerData.hp <= 0) {
        battleState.playerData.hp = 0;
        isDefeatedByDot = true;
    } else if (!isPlayer && battleState.enemy_current_hp <= 0) {
        battleState.enemy_current_hp = 0;
        isDefeatedByDot = true;
    }
    
    if (isPlayer) { 
        await new Promise((resolve, reject) => {
            if (!battleState.playerData.player_id) {
                console.error("processStatusEffects: player_id is missing, cannot update HP in DB.");
                resolve(); 
                return;
            }
            db.run(`UPDATE players SET hp = ? WHERE player_id = ?`, [battleState.playerData.hp, battleState.playerData.player_id], (err) => {
                if (err) { console.error("DB Error updating player HP after status effects:", err.message); reject(err); }
                else resolve();
            });
        });
    }
    return { isStunned: isStunnedThisTurn, isDefeated: isDefeatedByDot };
}

// Helper function to format active effects for display (copied from bossBattleManager.js)
function formatActiveEffects(effectsArray) {
    if (!effectsArray || effectsArray.length === 0) {
        return "لا يوجد";
    }
    return effectsArray.map(effect => {
        let emoji = '';
        switch (effect.name) {
            case 'BURN': emoji = '🔥'; break;
            case 'POISON': emoji = '☣️'; break;
            case 'STUN': emoji = '💫'; break;
            case 'DEFENSE_BUFF': emoji = '🛡️'; break;
            case 'ATTACK_BUFF': emoji = '⚔️'; break;
            case 'REGENERATE_HP': emoji = '❤️‍🩹'; break;
            case 'SLOW': emoji = '🐌'; break;
            default: emoji = '✨'; break;
        }
        return `${emoji} ${effect.name.replace(/_/g, ' ')} (${effect.duration} أدوار)`;
    }).join('\n');
}

async function handleLevelUp(db, playerData) { 
    let leveledUp = false;
    let currentLevelXpRequirement = await new Promise((res, rej) => {
        db.get(`SELECT xp_required FROM level_xp_requirements WHERE level = ?`, [playerData.level], (err, row) => {
            if (err) rej(err); else res(row ? row.xp_required : Infinity);
        });
    });
    let levelUpMessages = "";

    while (playerData.xp >= currentLevelXpRequirement) {
        leveledUp = true;
        playerData.xp -= currentLevelXpRequirement;
        playerData.level += 1;
        const hpIncrease = 10, mpIncrease = 5, statIncrease = 1;
        playerData.hp += hpIncrease;
        playerData.mp = (playerData.mp || 0) + mpIncrease;
        playerData.strength = (playerData.strength || 0) + statIncrease;
        playerData.defense = (playerData.defense || 0) + statIncrease;
        playerData.intelligence = (playerData.intelligence || 0) + statIncrease;
        playerData.speed = (playerData.speed || 0) + statIncrease;
        levelUpMessages += `\n\n**Level Up! You are now Level ${playerData.level}!**\n` +
                           `❤️ HP +${hpIncrease}, 💧 MP +${mpIncrease}, 💪 Str +${statIncrease}, 🛡️ Def +${statIncrease}, 🧠 Int +${statIncrease}, 🏃 Spd +${statIncrease}`;
        
        const newSkills = await new Promise((res, rej) => {
            db.all(`SELECT s.skill_id, s.name FROM skills s LEFT JOIN player_skills ps ON s.skill_id = ps.skill_id AND ps.player_id = ? WHERE ps.skill_id IS NULL AND s.level_requirement <= ? AND (s.class_restriction IS NULL OR s.class_restriction = ?)`,
                   [playerData.player_id, playerData.level, playerData.class], (err, rows) => {
                if (err) rej(err);
                else if (rows && rows.length > 0) {
                    const stmt = db.prepare(`INSERT INTO player_skills (player_id, skill_id) VALUES (?, ?)`);
                    let learnedNames = [];
                    let completedInserts = 0;
                    if (rows.length === 0) { 
                        stmt.finalize(() => res(learnedNames));
                        return;
                    }
                    rows.forEach(skill => {
                        stmt.run(playerData.player_id, skill.skill_id, function(runErr) { 
                            if(runErr) console.error(`Error learning skill ${skill.name}: ${runErr.message}`);
                            else learnedNames.push(skill.name);
                            completedInserts++;
                            if (completedInserts === rows.length) {
                                stmt.finalize(() => res(learnedNames));
                            }
                        });
                    });
                } else res([]);
            });
        });
        if (newSkills.length > 0) levelUpMessages += `\n✨ **New Skills Learned:** ${newSkills.join(', ')}!`;
        
        currentLevelXpRequirement = await new Promise((res, rej) => {
            db.get(`SELECT xp_required FROM level_xp_requirements WHERE level = ?`, [playerData.level], (err, row) => {
                if (err) rej(err); else res(row ? row.xp_required : Infinity);
            });
        });
    }
    return { leveledUp, levelUpMessages }; 
}

// --- Main Battle Action Handlers ---
async function handleDirectAttack(interaction, userId, db, battleLogArray) { 
    const battle = activeBattles[userId];
    const playerData = battle.playerData; 
    if (!playerData) { 
        console.error("handleDirectAttack: playerData is missing in battle state.");
        await interaction.editReply({ content: "Error: Your character data is missing for this action.", components: [] });
        return;
    }

    const modifiedPlayerStats = applyEffectsToStats(playerData, battle.player_effects || []);
    let enemyData = battle.enemy;
    const modifiedEnemyStats = applyEffectsToStats(enemyData, battle.enemy_effects || []);
    let enemyCurrentHp = battle.enemy_current_hp;

    const playerDamage = Math.max(1, (modifiedPlayerStats.strength || playerData.strength) - (modifiedEnemyStats.defense || enemyData.defense));
    enemyCurrentHp -= playerDamage;
    battle.enemy_current_hp = enemyCurrentHp;

    battleLog.push(`💥 You attacked **${enemyData.name}** for **${playerDamage}** damage!`);
    battleLog.push(`❤️‍🩹 **${enemyData.name}** HP: ${enemyCurrentHp}/${enemyData.hp}`);

    if (enemyCurrentHp <= 0) {
        battleLog.push(`🎉 **${enemyData.name}** has been defeated!`);
        battleLog.push(`✨ You gained **${enemyData.xp_reward} XP** and **${enemyData.coins_reward} Shadow Coins**!`);
        
        playerData.xp += enemyData.xp_reward;
        playerData.shadow_coins += enemyData.coins_reward;

        playerData.xp += enemyData.xp_reward; // Player who made the kill gets full XP for now. Party sharing can be complex.
        playerData.shadow_coins += enemyData.coins_reward; // Same for coins.

        battleLog.push(`✨ You gained **${enemyData.xp_reward} XP** and **${enemyData.coins_reward} Shadow Coins**!`);

        
        // --- Party XP/Coin Sharing ---
        const partyMembers = await new Promise((resolve, reject) => {
            db.all(`
                SELECT pm.player_id, p_player.discord_user_id, p_player.name as player_name 
                FROM party_members pm 
                JOIN players p_player ON pm.player_id = p_player.player_id
                WHERE pm.party_id = (SELECT party_id FROM party_members WHERE player_id = ?) 
                      AND p_player.server_id = ?`, // Ensure members are on the same server
                [playerData.player_id, interaction.guild.id], 
                (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
        });

        let awardedPlayers = [];
        if (partyMembers && partyMembers.length > 0) {
            const xpShare = Math.floor(enemyData.xp_reward / partyMembers.length) || 0;
            const coinShare = Math.floor(enemyData.coins_reward / partyMembers.length) || 0;
            battleLog.push(`\n💰 Party shared: Each member received ${xpShare} XP and ${coinShare} Coins.`);

            for (const member of partyMembers) {
                // Fetch full data for each member to update and level up
                let memberData = await new Promise((resolve, reject) => {
                    db.get("SELECT * FROM players WHERE player_id = ?", [member.player_id], (err, row) => {
                        if(err) reject(err); else resolve(row);
                    });
                });

                if(memberData){
                    memberData.xp += xpShare;
                    memberData.shadow_coins += coinShare;
                    
                    let { leveledUp: memberLeveledUp, levelUpMessages: memberLevelUpMessages } = await handleLevelUp(db, memberData);
                    if (memberLeveledUp) {
                        battleLog.push(`\n🎉 **${memberData.name} (Party Member)** leveled up! ${memberLevelUpMessages}`);
                        // Potentially DM the party member about their level up if not the current interactor
                        if (memberData.discord_user_id !== userId) {
                            const memberUser = await interaction.client.users.fetch(memberData.discord_user_id).catch(()=>null);
                            if(memberUser) memberUser.send(`You leveled up to ${memberData.level} in your party battle! ${memberLevelUpMessages}`).catch(console.error);
                        }
                    }
                    // Update each member
                    db.run(`UPDATE players SET hp = ?, mp = ?, strength = ?, defense = ?, intelligence = ?, speed = ?, level = ?, xp = ?, shadow_coins = ? WHERE player_id = ?`,
                           [memberData.hp, memberData.mp, memberData.strength, memberData.defense, memberData.intelligence, memberData.speed, memberData.level, memberData.xp, memberData.shadow_coins, memberData.player_id]);
                    awardedPlayers.push(memberData.name);
                }
            }
        } else {
            // Solo player or error fetching party - give rewards to current player only
            playerData.xp += enemyData.xp_reward;
            playerData.shadow_coins += enemyData.coins_reward;
            battleLog.push(`✨ You gained **${enemyData.xp_reward} XP** and **${enemyData.coins_reward} Shadow Coins**!`);
            let { leveledUp, levelUpMessages } = await handleLevelUp(db, playerData);
            if (leveledUp) battleLog.push(levelUpMessages);
            db.run(`UPDATE players SET hp = ?, mp = ?, strength = ?, defense = ?, intelligence = ?, speed = ?, level = ?, xp = ?, shadow_coins = ? WHERE player_id = ?`,
                   [playerData.hp, playerData.mp, playerData.strength, playerData.defense, playerData.intelligence, playerData.speed, playerData.level, playerData.xp, playerData.shadow_coins, playerData.player_id]);
            awardedPlayers.push(playerData.name);
        }
        
        delete activeBattles[userId];
        const victoryEmbed = new EmbedBuilder().setColor(0x00FF00).setTitle('🏆 Victory! 🏆').setDescription(battleLog.join('\n')).setThumbnail(enemyData.image_url || null);
        if(awardedPlayers.length > 0) victoryEmbed.setFooter({text: `Rewards distributed to: ${awardedPlayers.join(', ')}`});
        await interaction.editReply({ embeds: [victoryEmbed], components: [] }); 
        return;
    }

    // Enemy's turn
    let enemyTurnLog = [];
    const enemyEffectResult = await processStatusEffects('enemy', battle, db, enemyTurnLog);
    battleLog.push(...enemyTurnLog);

    if (enemyEffectResult.isDefeated) {
        battleLog.push(`🎉 **${enemyData.name}** succumbed to status effects and was defeated!`);
        playerData.xp += enemyData.xp_reward;
        playerData.shadow_coins += enemyData.coins_reward;
        playerData.xp += enemyData.xp_reward; // Player who made the kill gets full XP
        playerData.shadow_coins += enemyData.coins_reward; // Player who made the kill gets full coins
        battleLog.push(`✨ You gained **${enemyData.xp_reward} XP** and **${enemyData.coins_reward} Shadow Coins** from the enemy succumbing to effects!`);

        
        // --- Party XP/Coin Sharing on enemy defeat by DOT ---
        const partyMembersDot = await new Promise((resolve, reject) => {
            db.all(`
                SELECT pm.player_id, p_player.discord_user_id, p_player.name as player_name 
                FROM party_members pm 
                JOIN players p_player ON pm.player_id = p_player.player_id
                WHERE pm.party_id = (SELECT party_id FROM party_members WHERE player_id = ?) 
                      AND p_player.server_id = ?`,
                [playerData.player_id, interaction.guild.id], 
                (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
        });

        let awardedPlayersDot = [];
        if (partyMembersDot && partyMembersDot.length > 0) {
            const xpShare = Math.floor(enemyData.xp_reward / partyMembersDot.length) || 0;
            const coinShare = Math.floor(enemyData.coins_reward / partyMembersDot.length) || 0;
            battleLog.push(`\n💰 Party shared: Each member received ${xpShare} XP and ${coinShare} Coins (enemy defeated by effects).`);

            for (const member of partyMembersDot) {
                let memberData = await new Promise((resolve, reject) => {
                     db.get("SELECT * FROM players WHERE player_id = ?", [member.player_id], (err, row) => {
                        if(err) reject(err); else resolve(row);
                    });
                });
                if(memberData){
                    memberData.xp += xpShare;
                    memberData.shadow_coins += coinShare;
                    let { leveledUp: memberLeveledUp, levelUpMessages: memberLevelUpMessages } = await handleLevelUp(db, memberData);
                    if (memberLeveledUp) {
                        battleLog.push(`\n🎉 **${memberData.name} (Party Member)** leveled up! ${memberLevelUpMessages}`);
                         if (memberData.discord_user_id !== userId) {
                            const memberUser = await interaction.client.users.fetch(memberData.discord_user_id).catch(()=>null);
                            if(memberUser) memberUser.send(`You leveled up to ${memberData.level} in your party battle! ${memberLevelUpMessages}`).catch(console.error);
                        }
                    }
                    db.run(`UPDATE players SET hp = ?, mp = ?, strength = ?, defense = ?, intelligence = ?, speed = ?, level = ?, xp = ?, shadow_coins = ? WHERE player_id = ?`,
                           [memberData.hp, memberData.mp, memberData.strength, memberData.defense, memberData.intelligence, memberData.speed, memberData.level, memberData.xp, memberData.shadow_coins, memberData.player_id]);
                    awardedPlayersDot.push(memberData.name);
                }
            }
        } else {
            // Solo player
            playerData.xp += enemyData.xp_reward;
            playerData.shadow_coins += enemyData.coins_reward;
            battleLog.push(`✨ You gained **${enemyData.xp_reward} XP** and **${enemyData.coins_reward} Shadow Coins** (enemy defeated by effects)!`);
            let { leveledUp, levelUpMessages } = await handleLevelUp(db, playerData);
            if (leveledUp) battleLog.push(levelUpMessages);
            db.run(`UPDATE players SET hp = ?, mp = ?, strength = ?, defense = ?, intelligence = ?, speed = ?, level = ?, xp = ?, shadow_coins = ? WHERE player_id = ?`,
                   [playerData.hp, playerData.mp, playerData.strength, playerData.defense, playerData.intelligence, playerData.speed, playerData.level, playerData.xp, playerData.shadow_coins, playerData.player_id]);
             awardedPlayersDot.push(playerData.name);
        }

        delete activeBattles[userId];
        const victoryEmbed = new EmbedBuilder().setColor(0x00FF00).setTitle('🏆 Victory! 🏆').setDescription(battleLog.join('\n')).setThumbnail(enemyData.image_url || null);
        if(awardedPlayersDot.length > 0) victoryEmbed.setFooter({text: `Rewards distributed to: ${awardedPlayersDot.join(', ')}`});
        await interaction.editReply({ embeds: [victoryEmbed], components: [] });
        return;
    }

    if (!enemyEffectResult.isStunned) {
        const enemyAttackModifiedStats = applyEffectsToStats(enemyData, battle.enemy_effects || []);
        const playerDefenseModifiedStats = applyEffectsToStats(playerData, battle.player_effects || []); 
        const enemyDamage = Math.max(1, (enemyAttackModifiedStats.attack || enemyData.attack) - (playerDefenseModifiedStats.defense || playerData.defense));
        playerData.hp -= enemyDamage;
        battleLog.push(`⚔️ **${enemyData.name}** retaliated, hitting you for **${enemyDamage}** damage!`);
    }
    
    battleLog.push(`❤️ Your HP: ${playerData.hp}`);
    db.run(`UPDATE players SET hp = ?, mp = ? WHERE player_id = ?`, [playerData.hp, playerData.mp, playerData.player_id]);

    if (playerData.hp <= 0) {
        delete activeBattles[userId];
        db.run(`UPDATE players SET hp = 1 WHERE player_id = ?`, [playerData.player_id]);
        battleLog.push(`\n☠️ **You have been defeated by ${enemyData.name}!**`);
        const defeatEmbed = new EmbedBuilder().setColor(0xFF0000).setTitle('💀 Defeat! 💀').setDescription(battleLog.join('\n')).setThumbnail(enemyData.image_url || null);
        await interaction.editReply({ embeds: [defeatEmbed], components: [] });
        return;
    }

    const battleContinuesEmbed = new EmbedBuilder().setColor(0xFFFF00).setTitle(`⚔️ Battle with ${enemyData.name} ⚔️`)
        .setDescription(battleLog.join('\n'))
        .addFields(
            { name: `🔴 ${enemyData.name} HP`, value: `❤️ ${battle.enemy_current_hp}/${enemyData.hp}`, inline: true },
            { name: `🔴 Effects`, value: formatActiveEffects(battle.enemy_effects) || "لا يوجد", inline: true },
            { name: '\u200B', value: '\u200B', inline: false }, // Spacer
            { name: `🔵 ${playerData.name} HP`, value: `❤️ ${playerData.hp}`, inline: true },
            { name: `🔵 ${playerData.name} MP`, value: `💧 ${playerData.mp}`, inline: true },
            { name: `🔵 Your Effects`, value: formatActiveEffects(battle.player_effects) || "لا يوجد", inline: false }
        ).setThumbnail(enemyData.image_url || null).setFooter({ text: 'Choose your next action!' });
    await interaction.editReply({ embeds: [battleContinuesEmbed], components: getBattleActionRow() });
}

async function handleDirectFlee(interaction, userId, db, battleLog) { 
    const battle = activeBattles[userId];
    const playerData = battle.playerData; 
    if (!playerData) {
        console.error("handleDirectFlee: playerData is missing in battle state.");
        await interaction.editReply({ content: "Error: Your character data is missing for this action.", components: [] });
        return;
    }

    const modifiedPlayerStats = applyEffectsToStats(playerData, battle.player_effects || []);
    const enemyData = battle.enemy;
    const modifiedEnemyStats = applyEffectsToStats(enemyData, battle.enemy_effects || []);

    const BASE_FLEE_SUCCESS_RATE = 0.5;
    let fleeSuccessRate = BASE_FLEE_SUCCESS_RATE;
    if ((modifiedPlayerStats.speed || playerData.speed) > (modifiedEnemyStats.speed || enemyData.speed)) fleeSuccessRate += 0.15;
    else if ((modifiedPlayerStats.speed || playerData.speed) < (modifiedEnemyStats.speed || enemyData.speed)) fleeSuccessRate -= 0.15;
    fleeSuccessRate = Math.max(0.1, Math.min(0.9, fleeSuccessRate));

    if (Math.random() < fleeSuccessRate) {
        delete activeBattles[userId];
        battleLog.push(`💨 You successfully fled from **${enemyData.name}**!`);
        const fleeEmbed = new EmbedBuilder().setColor(0x00FF00).setTitle('💨 Successful Escape! 💨').setDescription(battleLog.join('\n'));
        await interaction.editReply({ embeds: [fleeEmbed], components: [] });
    } else {
        battleLog.push(`🏃 You tried to flee from **${enemyData.name}**, but failed!`);
        
        let enemyTurnLog = [];
        const enemyEffectResult = await processStatusEffects('enemy', battle, db, enemyTurnLog);
        battleLog.push(...enemyTurnLog);

        if (enemyEffectResult.isDefeated) {
            battleLog.push(`🎉 **${enemyData.name}** succumbed to status effects and was defeated!`);
            playerData.xp += enemyData.xp_reward;
            playerData.shadow_coins += enemyData.coins_reward;
            let { levelUpMessages } = await handleLevelUp(db, playerData);
            if (levelUpMessages) battleLog.push(levelUpMessages);
            
            db.run(`UPDATE players SET hp = ?, mp = ?, strength = ?, defense = ?, intelligence = ?, speed = ?, level = ?, xp = ?, shadow_coins = ? WHERE player_id = ?`,
                   [playerData.hp, playerData.mp, playerData.strength, playerData.defense, playerData.intelligence, playerData.speed, playerData.level, playerData.xp, playerData.shadow_coins, playerData.player_id]);
            delete activeBattles[userId];
            const victoryEmbed = new EmbedBuilder().setColor(0x00FF00).setTitle('🏆 Victory! 🏆').setDescription(battleLog.join('\n')).setThumbnail(enemyData.image_url || null);
            await interaction.editReply({ embeds: [victoryEmbed], components: [] });
            return;
        }

        if (!enemyEffectResult.isStunned) {
            const enemyAttackModifiedStats = applyEffectsToStats(enemyData, battle.enemy_effects || {});
            const playerDefenseModifiedStats = applyEffectsToStats(playerData, battle.player_effects || {});
            const enemyDamage = Math.max(1, (enemyAttackModifiedStats.attack || enemyData.attack) - (playerDefenseModifiedStats.defense || playerData.defense));
            playerData.hp -= enemyDamage;
            battleLog.push(`⚔️ **${enemyData.name}** retaliated, hitting you for **${enemyDamage}** damage!`);
        }
        
        battleLog.push(`❤️ Your HP: ${playerData.hp}`);
        db.run(`UPDATE players SET hp = ? WHERE player_id = ?`, [playerData.hp, playerData.player_id]);
        
        if (playerData.hp <= 0) {
            delete activeBattles[userId];
            db.run(`UPDATE players SET hp = 1 WHERE player_id = ?`, [playerData.player_id]);
            battleLog.push(`\n☠️ **You have been defeated by ${enemyData.name} after failing to flee!**`);
            const defeatEmbed = new EmbedBuilder().setColor(0xFF0000).setTitle('💀 Defeated While Fleeing! 💀').setDescription(battleLog.join('\n')).setThumbnail(enemyData.image_url || null);
            await interaction.editReply({ embeds: [defeatEmbed], components: [] });
        } else {
            const failedFleeEmbed = new EmbedBuilder().setColor(0xFFFF00).setTitle('🏃 Failed Escape! 🏃').setDescription(battleLog.join('\n'))
                .addFields(
                    { name: `🔴 ${enemyData.name} HP`, value: `❤️ ${battle.enemy_current_hp}/${enemyData.hp}`, inline: true },
                    { name: `🔴 Effects`, value: formatActiveEffects(battle.enemy_effects) || "لا يوجد", inline: true },
                    { name: '\u200B', value: '\u200B', inline: false },
                    { name: `🔵 ${playerData.name} HP`, value: `❤️ ${playerData.hp}`, inline: true },
                    { name: `🔵 ${playerData.name} MP`, value: `💧 ${playerData.mp}`, inline: true },
                    { name: `🔵 Your Effects`, value: formatActiveEffects(battle.player_effects) || "لا يوجد", inline: false }
                ).setThumbnail(enemyData.image_url || null).setFooter({ text: 'The battle continues. Choose your action.' });
            await interaction.editReply({ embeds: [failedFleeEmbed], components: getBattleActionRow() });
        }
    }
}

async function handleSkillUse(interaction, userId, db, skillIdToUse, battleLogArray) { 
    const battle = activeBattles[userId];
    const playerData = battle.playerData; 
    if (!playerData) {
        console.error("handleSkillUse: playerData is missing in battle state.");
        await interaction.editReply({ content: "Error: Your character data is missing for this action.", components: [] });
        return;
    }

    const skillDetails = await new Promise((resolve, reject) => {
        db.get(`SELECT * FROM skills WHERE skill_id = ?`, [skillIdToUse], (err, row) => err ? reject(err) : resolve(row));
    });

    if (!skillDetails) {
        battleLogArray.push('Skill details not found.');
        await interaction.editReply({ content: battleLogArray.join('\n'), components: [getBattleActionRow()] }); 
        return;
    }

    if (playerData.mp < skillDetails.mp_cost) {
        battleLogArray.push(`Not enough MP for **${skillDetails.name}**! (Need ${skillDetails.mp_cost}, Have ${playerData.mp})`);
        const skillListEmbed = new EmbedBuilder().setColor(0xFF0000).setTitle("❌ Not Enough MP ❌").setDescription(battleLogArray.join('\n'));
        await interaction.editReply({ embeds: [skillListEmbed], components: [getBattleActionRow()] }); 
        return;
    }

    playerData.mp -= skillDetails.mp_cost;
    battleLogArray.push(`✨ Used **${skillDetails.name}**! (-${skillDetails.mp_cost}MP)`);

    let enemyData = battle.enemy;
    let enemyCurrentHp = battle.enemy_current_hp;

    if (skillDetails.target_type === 'ENEMY') {
        let skillDamage = 0;
        const playerAttackModifiedStats = applyEffectsToStats(playerData, battle.player_effects || []);
        const enemyDefenseModifiedStats = applyEffectsToStats(enemyData, battle.enemy_effects || []);

        if (skillDetails.damage_multiplier) {
            const relevantStat = playerData.class === 'ساحر' ? (playerAttackModifiedStats.intelligence || playerData.intelligence) : (playerAttackModifiedStats.strength || playerData.strength);
            skillDamage += Math.floor((relevantStat || 0) * skillDetails.damage_multiplier);
        }
        if (skillDetails.base_damage) skillDamage += skillDetails.base_damage;
        skillDamage = Math.max(1, skillDamage - (enemyDefenseModifiedStats.defense || enemyData.defense));
        enemyCurrentHp -= skillDamage;
        battle.enemy_current_hp = enemyCurrentHp;
        battleLogArray.push(`💥 Dealt **${skillDamage}** damage to **${enemyData.name}**.`);

        if (skillDetails.effect_type && skillDetails.effect_duration > 0 && skillDetails.effect_value !== null) {
            const existingEffectIndex = battle.enemy_effects.findIndex(e => e.name === skillDetails.effect_type);
            if (existingEffectIndex > -1) {
                battle.enemy_effects[existingEffectIndex].duration = skillDetails.effect_duration;
                battle.enemy_effects[existingEffectIndex].value = skillDetails.effect_value;
                battleLogArray.push(`⏱️ **${enemyData.name}**'s ${skillDetails.effect_type} refreshed to ${skillDetails.effect_duration} turns.`);
            } else {
                battle.enemy_effects.push({ name: skillDetails.effect_type, value: skillDetails.effect_value, duration: skillDetails.effect_duration, source_skill_name: skillDetails.name });
                battleLogArray.push(`✨ **${enemyData.name}** affected by **${skillDetails.effect_type}** for ${skillDetails.effect_duration} turns.`);
            }
        }
    } else if (skillDetails.target_type === 'SELF') {
        if (skillDetails.heal_amount) {
            const maxHpForPlayer = (playerData.level * 10) + (playerData.class === 'محارب' ? 100 : 80); 
            const actualHeal = Math.min(skillDetails.heal_amount, maxHpForPlayer - playerData.hp);
            playerData.hp += actualHeal;
            battleLogArray.push(`❤️ Healed for **${actualHeal} HP**. HP: ${playerData.hp}.`);
        }
        if (skillDetails.effect_type && skillDetails.effect_duration > 0 && skillDetails.effect_value !== null) {
            const existingEffectIndex = battle.player_effects.findIndex(e => e.name === skillDetails.effect_type);
            if (existingEffectIndex > -1) {
                battle.player_effects[existingEffectIndex].duration = skillDetails.effect_duration;
                battle.player_effects[existingEffectIndex].value = skillDetails.effect_value;
                battleLogArray.push(`⏱️ Your ${skillDetails.effect_type} refreshed to ${skillDetails.effect_duration} turns.`);
            } else {
                battle.player_effects.push({ name: skillDetails.effect_type, value: skillDetails.effect_value, duration: skillDetails.effect_duration, source_skill_name: skillDetails.name });
                battleLogArray.push(`✨ You are affected by **${skillDetails.effect_type}** for ${skillDetails.effect_duration} turns.`);
            }
        }
    }
    battleLogArray.push(`❤️‍🩹 **${enemyData.name}** HP: ${enemyCurrentHp}/${enemyData.hp}`);

    if (enemyCurrentHp <= 0) {
        battleLogArray.push(`🎉 **${enemyData.name}** has been defeated!`);
        battleLogArray.push(`✨ You gained **${enemyData.xp_reward} XP** and **${enemyData.coins_reward} Shadow Coins**!`);
        playerData.xp += enemyData.xp_reward;
        playerData.shadow_coins += enemyData.coins_reward;

        playerData.xp += enemyData.xp_reward; // Player who made the kill gets full XP
        playerData.shadow_coins += enemyData.coins_reward; // Player who made the kill gets full coins
        battleLogArray.push(`✨ You gained **${enemyData.xp_reward} XP** and **${enemyData.coins_reward} Shadow Coins**!`);


        // --- Party XP/Coin Sharing on skill kill ---
        const partyMembersSkill = await new Promise((resolve, reject) => {
            db.all(`
                SELECT pm.player_id, p_player.discord_user_id, p_player.name as player_name 
                FROM party_members pm 
                JOIN players p_player ON pm.player_id = p_player.player_id
                WHERE pm.party_id = (SELECT party_id FROM party_members WHERE player_id = ?) 
                      AND p_player.server_id = ?`,
                [playerData.player_id, interaction.guild.id], 
                (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
        });
        
        let awardedPlayersSkill = [];
        if(partyMembersSkill && partyMembersSkill.length > 0){
            const xpShare = Math.floor(enemyData.xp_reward / partyMembersSkill.length) || 0;
            const coinShare = Math.floor(enemyData.coins_reward / partyMembersSkill.length) || 0;
            battleLogArray.push(`\n💰 Party shared: Each member received ${xpShare} XP and ${coinShare} Coins.`);

            for (const member of partyMembersSkill) {
                 let memberData = await new Promise((resolve, reject) => {
                    db.get("SELECT * FROM players WHERE player_id = ?", [member.player_id], (err, row) => {
                        if(err) reject(err); else resolve(row);
                    });
                });
                if(memberData){
                    memberData.xp += xpShare;
                    memberData.shadow_coins += coinShare;
                    let { leveledUp: memberLeveledUp, levelUpMessages: memberLevelUpMessages } = await handleLevelUp(db, memberData);
                    if (memberLeveledUp) {
                        battleLogArray.push(`\n🎉 **${memberData.name} (Party Member)** leveled up! ${memberLevelUpMessages}`);
                        if (memberData.discord_user_id !== userId) {
                            const memberUser = await interaction.client.users.fetch(memberData.discord_user_id).catch(()=>null);
                            if(memberUser) memberUser.send(`You leveled up to ${memberData.level} in your party battle! ${memberLevelUpMessages}`).catch(console.error);
                        }
                    }
                    db.run(`UPDATE players SET hp = ?, mp = ?, strength = ?, defense = ?, intelligence = ?, speed = ?, level = ?, xp = ?, shadow_coins = ? WHERE player_id = ?`,
                           [memberData.hp, memberData.mp, memberData.strength, memberData.defense, memberData.intelligence, memberData.speed, memberData.level, memberData.xp, memberData.shadow_coins, memberData.player_id]);
                    awardedPlayersSkill.push(memberData.name);
                }
            }
        } else {
            playerData.xp += enemyData.xp_reward;
            playerData.shadow_coins += enemyData.coins_reward;
            battleLogArray.push(`✨ You gained **${enemyData.xp_reward} XP** and **${enemyData.coins_reward} Shadow Coins**!`);
            let { leveledUp, levelUpMessages } = await handleLevelUp(db, playerData);
            if (leveledUp) battleLogArray.push(levelUpMessages);
             db.run(`UPDATE players SET hp = ?, mp = ?, strength = ?, defense = ?, intelligence = ?, speed = ?, level = ?, xp = ?, shadow_coins = ? WHERE player_id = ?`,
               [playerData.hp, playerData.mp, playerData.strength, playerData.defense, playerData.intelligence, playerData.speed, playerData.level, playerData.xp, playerData.shadow_coins, playerData.player_id]);
            awardedPlayersSkill.push(playerData.name);
        }


        delete activeBattles[userId];
        const victoryEmbed = new EmbedBuilder().setColor(0x00FF00).setTitle('🏆 Victory! 🏆').setDescription(battleLogArray.join('\n')).setThumbnail(enemyData.image_url || null);
        if(awardedPlayersSkill.length > 0) victoryEmbed.setFooter({text: `Rewards distributed to: ${awardedPlayersSkill.join(', ')}`});
        await interaction.editReply({ embeds: [victoryEmbed], components: [] });
        return;
    }

    // Enemy's turn
    let enemyTurnLog = [];
    const enemyEffectResult = await processStatusEffects('enemy', battle, db, enemyTurnLog);
    battleLogArray.push(...enemyTurnLog);

    if (enemyEffectResult.isDefeated) {
        battleLogArray.push(`🎉 **${enemyData.name}** succumbed to status effects and was defeated!`);
        playerData.xp += enemyData.xp_reward;
        playerData.shadow_coins += enemyData.coins_reward;
        playerData.xp += enemyData.xp_reward; // Player who made the kill gets full XP
        playerData.shadow_coins += enemyData.coins_reward; // Player who made the kill gets full coins
        battleLogArray.push(`✨ You gained **${enemyData.xp_reward} XP** and **${enemyData.coins_reward} Shadow Coins** from the enemy succumbing to effects!`);

        // --- Party XP/Coin Sharing on enemy defeat by DOT in skill use ---
        const partyMembersSkillDot = await new Promise((resolve, reject) => {
             db.all(`
                SELECT pm.player_id, p_player.discord_user_id, p_player.name as player_name 
                FROM party_members pm 
                JOIN players p_player ON pm.player_id = p_player.player_id
                WHERE pm.party_id = (SELECT party_id FROM party_members WHERE player_id = ?) 
                      AND p_player.server_id = ?`,
                [playerData.player_id, interaction.guild.id], 
                (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
        });

        let awardedPlayersSkillDot = [];
        if(partyMembersSkillDot && partyMembersSkillDot.length > 0) {
            const xpShare = Math.floor(enemyData.xp_reward / partyMembersSkillDot.length) || 0;
            const coinShare = Math.floor(enemyData.coins_reward / partyMembersSkillDot.length) || 0;
            battleLogArray.push(`\n💰 Party shared: Each member received ${xpShare} XP and ${coinShare} Coins (enemy defeated by effects).`);
            for (const member of partyMembersSkillDot) {
                 let memberData = await new Promise((resolve, reject) => {
                    db.get("SELECT * FROM players WHERE player_id = ?", [member.player_id], (err, row) => {
                        if(err) reject(err); else resolve(row);
                    });
                });
                if(memberData){
                    memberData.xp += xpShare;
                    memberData.shadow_coins += coinShare;
                    let { leveledUp: memberLeveledUp, levelUpMessages: memberLevelUpMessages } = await handleLevelUp(db, memberData);
                     if (memberLeveledUp) {
                        battleLogArray.push(`\n🎉 **${memberData.name} (Party Member)** leveled up! ${memberLevelUpMessages}`);
                        if (memberData.discord_user_id !== userId) {
                            const memberUser = await interaction.client.users.fetch(memberData.discord_user_id).catch(()=>null);
                            if(memberUser) memberUser.send(`You leveled up to ${memberData.level} in your party battle! ${memberLevelUpMessages}`).catch(console.error);
                        }
                    }
                    db.run(`UPDATE players SET hp = ?, mp = ?, strength = ?, defense = ?, intelligence = ?, speed = ?, level = ?, xp = ?, shadow_coins = ? WHERE player_id = ?`,
                           [memberData.hp, memberData.mp, memberData.strength, memberData.defense, memberData.intelligence, memberData.speed, memberData.level, memberData.xp, memberData.shadow_coins, memberData.player_id]);
                    awardedPlayersSkillDot.push(memberData.name);
                }
            }
        } else {
            playerData.xp += enemyData.xp_reward;
            playerData.shadow_coins += enemyData.coins_reward;
            battleLogArray.push(`✨ You gained **${enemyData.xp_reward} XP** and **${enemyData.coins_reward} Shadow Coins** (enemy defeated by effects)!`);
            let { leveledUp, levelUpMessages } = await handleLevelUp(db, playerData);
            if (leveledUp) battleLogArray.push(levelUpMessages);
            db.run(`UPDATE players SET hp = ?, mp = ?, strength = ?, defense = ?, intelligence = ?, speed = ?, level = ?, xp = ?, shadow_coins = ? WHERE player_id = ?`,
                   [playerData.hp, playerData.mp, playerData.strength, playerData.defense, playerData.intelligence, playerData.speed, playerData.level, playerData.xp, playerData.shadow_coins, playerData.player_id]);
            awardedPlayersSkillDot.push(playerData.name);
        }
        
        delete activeBattles[userId];
        const victoryEmbed = new EmbedBuilder().setColor(0x00FF00).setTitle('🏆 Victory! 🏆').setDescription(battleLogArray.join('\n')).setThumbnail(enemyData.image_url || null);
        if(awardedPlayersSkillDot.length > 0) victoryEmbed.setFooter({text: `Rewards distributed to: ${awardedPlayersSkillDot.join(', ')}`});
        await interaction.editReply({ embeds: [victoryEmbed], components: [] });
        return;
    }

    if (!enemyEffectResult.isStunned) {
        const enemyAttackModifiedStats = applyEffectsToStats(enemyData, battle.enemy_effects || {});
        const playerDefenseModifiedStats = applyEffectsToStats(playerData, battle.player_effects || {});
        const enemyDamage = Math.max(1, (enemyAttackModifiedStats.attack || enemyData.attack) - (playerDefenseModifiedStats.defense || playerData.defense));
        playerData.hp -= enemyDamage;
        battleLogArray.push(`⚔️ **${enemyData.name}** retaliated, hitting you for **${enemyDamage}** damage!`);
    }
    
    battleLogArray.push(`❤️ Your HP: ${playerData.hp}`);
    db.run(`UPDATE players SET hp = ?, mp = ? WHERE player_id = ?`, [playerData.hp, playerData.mp, playerData.player_id]);

    if (playerData.hp <= 0) {
        delete activeBattles[userId];
        db.run(`UPDATE players SET hp = 1 WHERE player_id = ?`, [playerData.player_id]);
        battleLogArray.push(`\n☠️ **You have been defeated by ${enemyData.name}!**`);
        const defeatEmbed = new EmbedBuilder().setColor(0xFF0000).setTitle('💀 Defeat! 💀').setDescription(battleLogArray.join('\n')).setThumbnail(enemyData.image_url || null);
        await interaction.editReply({ embeds: [defeatEmbed], components: [] });
        return;
    }

    const ongoingBattleEmbed = new EmbedBuilder().setColor(0xFFFF00).setTitle(`⚔️ Battle with ${enemyData.name} ⚔️`)
        .setDescription(battleLogArray.join('\n'))
        .addFields(
            { name: 'Enemy HP', value: `❤️ ${battle.enemy_current_hp}/${enemyData.hp}`, inline: true },
            { name: 'Your HP', value: `❤️ ${playerData.hp}`, inline: true },
            { name: 'Your MP', value: `💧 ${playerData.mp}`, inline: true }
        ).setThumbnail(enemyData.image_url || null).setFooter({ text: 'Choose your next action!' });
    await interaction.editReply({ embeds: [ongoingBattleEmbed], components: getBattleActionRow() });
}


// Helper to create the action row for battles
function getBattleActionRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('explore_attack')
                .setLabel('⚔️ Attack')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('explore_flee')
                .setLabel('🏃‍♂️ Flee')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('battle_show_skills')
                .setLabel('✨ Skills')
                .setStyle(ButtonStyle.Primary)
        );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('explore')
        .setDescription('Explores the current world for resources, items, or encounters.'),
    async execute(interaction) {
        const userId = interaction.user.id;
        const channelId = interaction.channel.id;
        const serverId = interaction.guild.id;

        await interaction.deferReply({ ephemeral: true });

        if (activeBattles[userId]) {
             const existingBattleEmbed = new EmbedBuilder()
                .setColor(0xFFFF00)
                .setTitle('❗ Ongoing Battle ❗')
                .setDescription(`You are already in a battle with **${activeBattles[userId].enemy.name}** (HP: ${activeBattles[userId].enemy_current_hp}/${activeBattles[userId].enemy.hp}).\nResolve it first!`)
                .setThumbnail(activeBattles[userId].enemy.image_url || null)
                .setFooter({text: "Use the buttons from the previous encounter message."});
            await interaction.followUp({ embeds: [existingBattleEmbed], components: [getBattleActionRow()], ephemeral: true });
            return;
        }
        
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => { 
            if (err) {
                console.error('Explore - Error opening database:', err.message);
                interaction.followUp({ content: 'Failed to connect to the game database. Please try again later.', ephemeral: true });
                return;
            }
        });

        db.get(`SELECT w.name as world_name FROM worlds w JOIN world_channels wc ON w.world_id = wc.world_id WHERE wc.channel_id = ? AND w.server_id = ?`, 
                [channelId, serverId], async (err, row) => {
            if (err || !row) {
                await interaction.followUp({ content: 'You must be in a world-specific channel to explore.', ephemeral: true });
                db.close(); return;
            }
            const currentWorldName = row.world_name;

            db.all(`SELECT * FROM enemies WHERE world_name = ?`, [currentWorldName], async (err, enemiesInWorld) => {
                if (err || enemiesInWorld.length === 0) {
                    await interaction.followUp({ content: `You explore ${currentWorldName}, but find nothing of interest.`, ephemeral: true });
                    db.close(); return;
                }

                if (Math.random() < 0.4) { 
                    await interaction.followUp({ content: `You explore ${currentWorldName} for a while... but find nothing of interest this time.`, ephemeral: true });
                    db.close(); return;
                }

                const chosenEnemy = enemiesInWorld[Math.floor(Math.random() * enemiesInWorld.length)];
                activeBattles[userId] = { 
                    player_effects: [], 
                    enemy_effects: [],  
                    enemy: chosenEnemy, 
                    enemy_current_hp: chosenEnemy.hp,
                    worldName: currentWorldName,
                    playerData: null 
                };

                const enemyEmbed = new EmbedBuilder().setColor(0xFF0000).setTitle(`⚔️ Encounter! ⚔️`)
                    .setDescription(`You encountered a wild **${chosenEnemy.name}**!`)
                    .addFields(
                        { name: 'HP', value: `❤️ ${chosenEnemy.hp}`, inline: true },
                        { name: 'Attack', value: `⚔️ ${chosenEnemy.attack}`, inline: true },
                        { name: 'Defense', value: `🛡️ ${chosenEnemy.defense}`, inline: true }
                    ).setThumbnail(chosenEnemy.image_url || null).setFooter({ text: 'Choose your action!' });
                
                await interaction.followUp({ embeds: [enemyEmbed], components: [getBattleActionRow()], ephemeral: true });
                db.close();
            });
        });
    },

    async handleExploreButton(interaction) {
        const customId = interaction.customId;
        const userId = interaction.user.id;
        
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, async (dbErr) => {
            if (dbErr) { 
                console.error("ExploreButtonHandler - DB Open Error:", dbErr.message);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'Database connection error.', ephemeral: true });
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: 'Database connection error.', components: [] });
                }
                return;
            }

            const battle = activeBattles[userId];
            if (!battle && !customId.startsWith('battle_show_skills') && customId !== 'battle_return_to_main_actions') { 
                await interaction.update({ content: 'This battle has already ended.', components: [] });
                db.close(); return;
            }
            
            if (battle && (customId.startsWith('explore_') || customId.startsWith('battle_use_skill_'))) {
                 battle.playerData = await new Promise((resolve, reject) => {
                    db.get(`SELECT * FROM players WHERE discord_user_id = ? AND server_id = ?`, [userId, interaction.guild.id], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });
                if (!battle.playerData) {
                    await interaction.update({ content: "Could not retrieve your character data for this turn.", components: []});
                    db.close(); return;
                }
            }

            try {
                if(!interaction.deferred) await interaction.deferUpdate(); 
                
                let battleLog = []; 

                if (battle && battle.playerData && (customId.startsWith('explore_') || customId.startsWith('battle_use_skill_'))) {
                    const playerEffectResult = await processStatusEffects('player', battle, db, battleLog);
                    if (playerEffectResult.isDefeated) {
                        battleLog.push(`\n☠️ **You succumbed to status effects before you could act!**`);
                        delete activeBattles[userId];
                        const defeatEmbed = new EmbedBuilder().setColor(0xFF0000).setTitle('💀 Defeat! 💀').setDescription(battleLog.join('\n')).setThumbnail(battle.enemy.image_url || null);
                        await interaction.editReply({ embeds: [defeatEmbed], components: [] });
                        db.close(); return;
                    }
                    if (playerEffectResult.isStunned) {
                        battleLog.push(`😵 You are stunned and skip your turn!`);
                        let enemyTurnLog = [];
                        const enemyEffectProcResult = await processStatusEffects('enemy', battle, db, enemyTurnLog);
                        battleLog.push(...enemyTurnLog);

                        if (enemyEffectProcResult.isDefeated) {
                            battleLog.push(`🎉 **${battle.enemy.name}** succumbed to status effects and was defeated!`);
                             battle.playerData.xp += battle.enemy.xp_reward;
                             battle.playerData.shadow_coins += battle.enemy.coins_reward;
                             let { levelUpMessages } = await handleLevelUp(db, battle.playerData);
                             if (levelUpMessages) battleLog.push(levelUpMessages);
        
        // Update Kill Quests for the acting player
        const questProgressMessages = await updateKillQuestProgress(db, playerData.player_id, enemyData.name, interaction.client, userId);
        if (questProgressMessages.length > 0) {
            battleLog.push(`\n📜 Quest Updates:\n- ${questProgressMessages.join('\n- ')}`);
        }


        // Update Kill Quests for the acting player
        const skillQuestProgressMessages = await updateKillQuestProgress(db, playerData.player_id, enemyData.name, interaction.client, userId);
        if (skillQuestProgressMessages.length > 0) {
            battleLogArray.push(`\n📜 Quest Updates:\n- ${skillQuestProgressMessages.join('\n- ')}`);
        }

                             db.run(`UPDATE players SET hp = ?, mp = ?, strength = ?, defense = ?, intelligence = ?, speed = ?, level = ?, xp = ?, shadow_coins = ? WHERE player_id = ?`,
                                   [battle.playerData.hp, battle.playerData.mp, battle.playerData.strength, battle.playerData.defense, battle.playerData.intelligence, battle.playerData.speed, battle.playerData.level, battle.playerData.xp, battle.playerData.shadow_coins, battle.playerData.player_id]);
                            delete activeBattles[userId];
                            const victoryEmbed = new EmbedBuilder().setColor(0x00FF00).setTitle('🏆 Victory! 🏆').setDescription(battleLog.join('\n')).setThumbnail(battle.enemy.image_url || null);
                            await interaction.editReply({ embeds: [victoryEmbed], components: [] });
                        } else if (!enemyEffectProcResult.isStunned) {
                            const enemyAttackModifiedStats = applyEffectsToStats(battle.enemy, battle.enemy_effects || []);
                            const playerDefenseModifiedStats = applyEffectsToStats(battle.playerData, battle.player_effects || []);
                            const enemyDamage = Math.max(1, (enemyAttackModifiedStats.attack || battle.enemy.attack) - (playerDefenseModifiedStats.defense || battle.playerData.defense));
                            battle.playerData.hp -= enemyDamage;
                            battleLog.push(`⚔️ **${battle.enemy.name}** attacked, hitting you for **${enemyDamage}** damage!`);
                            db.run(`UPDATE players SET hp = ? WHERE player_id = ?`, [battle.playerData.hp, battle.playerData.player_id]);

                            if (battle.playerData.hp <= 0) {
                                battleLog.push(`\n☠️ **You have been defeated!**`);
                                delete activeBattles[userId];
                                db.run(`UPDATE players SET hp = 1 WHERE player_id = ?`, [battle.playerData.player_id]);
                                const defeatEmbed = new EmbedBuilder().setColor(0xFF0000).setTitle('💀 Defeat! 💀').setDescription(battleLog.join('\n')).setThumbnail(battle.enemy.image_url || null);
                                await interaction.editReply({ embeds: [defeatEmbed], components: [] });
                            } else {
                                const stunTurnEmbed = new EmbedBuilder().setColor(0xFFFF00).setTitle("😵 Stunned! 😵").setDescription(battleLog.join('\n'))
                                    .addFields(
                                        { name: 'Enemy HP', value: `❤️ ${battle.enemy_current_hp}/${battle.enemy.hp}`, inline: true },
                                        { name: 'Your HP', value: `❤️ ${battle.playerData.hp}`, inline: true },
                                        { name: 'Your MP', value: `💧 ${battle.playerData.mp}`, inline: true }
                                    ).setThumbnail(battle.enemy.image_url || null);
                                await interaction.editReply({ embeds: [stunTurnEmbed], components: getBattleActionRow() });
                            }
                        } else { 
                             const stillStunnedEmbed = new EmbedBuilder().setColor(0xFFFF00).setTitle("😵 Stunned! 😵").setDescription(battleLog.join('\n'))
                                .addFields(
                                    { name: 'Enemy HP', value: `❤️ ${battle.enemy_current_hp}/${battle.enemy.hp}`, inline: true },
                                    { name: 'Your HP', value: `❤️ ${battle.playerData.hp}`, inline: true },
                                    { name: 'Your MP', value: `💧 ${battle.playerData.mp}`, inline: true }
                                ).setThumbnail(battle.enemy.image_url || null);
                            await interaction.editReply({ embeds: [stillStunnedEmbed], components: getBattleActionRow() });
                        }
                        db.close(); return;
                    }
                }

                if (customId === 'explore_attack') {
                    await handleDirectAttack(interaction, userId, db, battleLog);
                } else if (customId === 'explore_flee') {
                    await handleDirectFlee(interaction, userId, db, battleLog);
                } else if (customId === 'battle_show_skills') {
                    if (!battle || !battle.playerData) { // Ensure battle and playerData exist for showing skills
                         await interaction.editReply({ content: "Cannot display skills, battle data is missing or you are not in a battle.", components: [] });
                         db.close(); return;
                    }
                    const playerSkills = await new Promise((resolve, reject) => { 
                        db.all(`SELECT s.skill_id, s.name, s.mp_cost, s.description FROM skills s JOIN player_skills ps ON s.skill_id = ps.skill_id WHERE ps.player_id = ?`, [battle.playerData.player_id], (err, rows) => {
                            if (err) reject(err); else resolve(rows);
                        });
                    });
                    if (!playerSkills || playerSkills.length === 0) {
                        battleLog.push("You haven't learned any skills yet!");
                        await interaction.editReply({ content: battleLog.join('\n'), components: [getBattleActionRow()] });
                    } else {
                        const currentPlayerMp = battle.playerData.mp;
                        const skillButtons = playerSkills.map(skill => new ButtonBuilder().setCustomId(`battle_use_skill_${skill.skill_id}`).setLabel(`${skill.name} (MP: ${skill.mp_cost})`).setStyle(ButtonStyle.Success).setDisabled(currentPlayerMp < skill.mp_cost));
                        const skillActionRows = [];
                        for (let i = 0; i < skillButtons.length; i += 5) skillActionRows.push(new ActionRowBuilder().addComponents(skillButtons.slice(i, i + 5)));
                        if (skillActionRows.length < 5) skillActionRows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('battle_return_to_main_actions').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)));
                        
                        const skillsEmbed = new EmbedBuilder().setColor(0x0000FF).setTitle('✨ Your Skills ✨').setDescription((battleLog.length > 0 ? battleLog.join('\n') + '\n\n' : '') + 'Select a skill:').setFooter({text: "MP-unavailable skills are disabled."});
                        playerSkills.forEach(skill => skillsEmbed.addFields({name: `${skill.name} (MP: ${skill.mp_cost})`, value: skill.description}));
                        await interaction.editReply({ embeds: [skillsEmbed], components: skillActionRows });
                    }
                } else if (customId.startsWith('battle_use_skill_')) {
                    const skillIdToUse = parseInt(customId.split('_')[3], 10);
                    await handleSkillUse(interaction, userId, db, skillIdToUse, battleLog);
                } else if (customId === 'battle_return_to_main_actions') {
                     if (!battle || !battle.playerData) {
                         await interaction.editReply({ content: "Cannot return, battle data is missing or you are not in a battle.", components: [] });
                         db.close(); return;
                    }
                    const returnEmbed = new EmbedBuilder().setColor(0xFF0000).setTitle(`⚔️ Battle with ${battle.enemy.name} ⚔️`)
                        .setDescription((battleLog.length > 0 ? battleLog.join('\n') + '\n\n' : '') + 'Choose your action.')
                        .addFields(
                            { name: 'Enemy HP', value: `❤️ ${battle.enemy_current_hp}/${battle.enemy.hp}`, inline: true },
                            { name: 'Your HP', value: `❤️ ${battle.playerData.hp}`, inline: true },
                            { name: 'Your MP', value: `💧 ${battle.playerData.mp}`, inline: true }
                        ).setThumbnail(battle.enemy.image_url || null);
                    await interaction.editReply({ embeds: [returnEmbed], components: getBattleActionRow() });
                } else {
                    console.log(`Unknown explore button ID: ${customId}`);
                    await interaction.editReply({content: 'Unknown action.', components: []});
                }
            } catch (error) {
                console.error(`Error in handleExploreButton for ${customId}:`, error);
                if (!interaction.replied) { 
                    try { await interaction.editReply({ content: 'An error occurred processing your action.', components:[] }); }
                    catch (e) { console.error("Failed to editReply on general error:", e); }
                }
            } finally {
                db.close((closeErr) => { if (closeErr) console.error('ExploreButtonHandler - DB Close Error:', closeErr.message); });
            }
        });
    }
};
