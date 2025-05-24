const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');
const dbPath = path.join(__dirname, 'data', 'shadow_realms.db');

const activeBossBattles = new Map();

function generateBattleId(bossName) {
    return `boss_${bossName.replace(/\s+/g, '')}_${Date.now()}`;
}

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

async function processStatusEffects(targetObject, isPlayerTarget, db, battleLogArray, battleState) {
    const effectsArray = isPlayerTarget ? targetObject.effects : battleState.boss_effects;
    const targetName = isPlayerTarget ? targetObject.name : battleState.boss_data.name;
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
                if (isPlayerTarget) targetObject.hp -= dotDamage;
                else battleState.boss_current_hp -= dotDamage;
                effectAppliedMessage = `🩸 ${targetName} took ${dotDamage} damage from ${effect.name}.`;
                break;
            case 'REGENERATE_HP':
                const basePlayerDataForHp = isPlayerTarget ? targetObject.playerData : null; 
                const classForHp = isPlayerTarget && basePlayerDataForHp && basePlayerDataForHp.class ? basePlayerDataForHp.class : 'محارب'; 
                const levelForHp = isPlayerTarget && basePlayerDataForHp && basePlayerDataForHp.level ? basePlayerDataForHp.level : 1; 
                const classDefaultHp = classForHp === 'محارب' ? 100 : (classForHp === 'ساحر' ? 80 : 90);
                const maxHp = isPlayerTarget ? ((levelForHp * 10) + classDefaultHp) : battleState.boss_data.hp;
                
                const healAmount = effect.value || 0;
                let actualHeal = 0;
                if (isPlayerTarget) {
                    actualHeal = Math.min(healAmount, maxHp - targetObject.hp);
                    if (actualHeal > 0) targetObject.hp += actualHeal;
                } else { 
                    actualHeal = Math.min(healAmount, maxHp - battleState.boss_current_hp);
                    if (actualHeal > 0) battleState.boss_current_hp += actualHeal;
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

    if (isPlayerTarget && targetObject.hp <= 0) {
        targetObject.hp = 0;
        isDefeatedByDot = true;
    } else if (!isPlayerTarget && battleState.boss_current_hp <= 0) {
        battleState.boss_current_hp = 0;
        isDefeatedByDot = true;
    }
    
    if (isPlayerTarget) { 
        await new Promise((resolve, reject) => {
            if (!targetObject.playerId) {
                console.error("processStatusEffects (boss battle player): player_id is missing.");
                resolve(); 
                return;
            }
            db.run(`UPDATE players SET hp = ? WHERE player_id = ?`, [targetObject.hp, targetObject.playerId], (err) => {
                if (err) { console.error("DB Error updating player HP after status effects (boss battle):", err.message); reject(err); }
                else resolve();
            });
        });
    }
    return { isStunned: isStunnedThisTurn, isDefeated: isDefeatedByDot };
}

async function handleLevelUp(db, playerData) { 
    let leveledUp = false;
    playerData.level = playerData.level || 1;
    playerData.xp = playerData.xp || 0;

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
        playerData.hp = (playerData.hp || 0) + hpIncrease;
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


function getBossBattleActionRow(battle_id, discordUserId, isPlayerTurn = true, skillsAvailable = true) {
    const row = new ActionRowBuilder();
    if (isPlayerTurn) {
        row.addComponents(
            new ButtonBuilder().setCustomId(`bossbattle_attack_${battle_id}_${discordUserId}`).setLabel('⚔️ Attack').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`bossbattle_show_skills_${battle_id}_${discordUserId}`).setLabel('✨ Skills').setStyle(ButtonStyle.Primary).setDisabled(!skillsAvailable)
        );
    }
    return row;
}

// Helper function to format active effects for display
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


async function startBossBattle(interaction, bossData, initialParticipantsData) {
    const battle_id = generateBattleId(bossData.name);
    const firstParticipant = initialParticipantsData[0];

    const participants = initialParticipantsData.map(pData => ({
        playerId: pData.player_id,
        discordUserId: pData.discord_user_id,
        name: pData.name,
        playerData: { ...pData }, 
        hp: pData.hp, 
        mp: pData.mp,
        effects: [] 
    }));

    const db = new sqlite3.Database(dbPath);
    let bossSkills = [];
    try {
        bossSkills = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM skills WHERE name IN (?, ?, ?)", 
                   ["Eruption", "Magma Shield", "Summon Fire Imps"], 
                   (err, skills) => {
                if (err) {
                    console.error("Error fetching boss skills:", err.message);
                    reject(err);
                } else {
                    resolve(skills);
                }
            });
        });
    } catch (e) {
        console.error("Failed to fetch boss skills, proceeding without them.", e);
    } finally {
        db.close(); // Close db after fetching skills
    }
    
    const battleState = {
        battle_id,
        boss_data: { ...bossData, max_hp: bossData.hp }, 
        boss_current_hp: bossData.hp,
        boss_effects: [],
        boss_skills: bossSkills, 
        participants,
        current_turn_participant_index: 0,
        message_interaction: null, 
        battle_log: [`🔥 **${bossData.name}** has been summoned! 🔥\nIt's **${firstParticipant.name}**'s turn.`],
        turn_count: 1,
        client: interaction.client 
    };
    activeBossBattles.set(battle_id, battleState);

    const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle(`ボス戦開始！ - ${bossData.name}`)
        .setDescription(battleState.battle_log[0])
        .setImage(bossData.image_url)
        .addFields({ name: `${bossData.name} HP`, value: `❤️ ${battleState.boss_current_hp}/${battleState.boss_data.hp}`, inline: false });

    participants.forEach(p => {
        embed.addFields({ name: `${p.name} HP`, value: `❤️ ${p.hp}/${p.playerData.hp}`, inline: true});
        embed.addFields({ name: `${p.name} MP`, value: `💧 ${p.mp}/${p.playerData.mp}`, inline: true});
    });
    
    const dbCheckSkills = new sqlite3.Database(dbPath);
    const firstPlayerSkillsData = await new Promise((resolve, reject) => {
        dbCheckSkills.all("SELECT skill_id FROM player_skills WHERE player_id = ?", [firstParticipant.playerId], (err, r) => {
            if (err) reject(err); else resolve(r || []);
        });
    }).finally(() => dbCheckSkills.close());
    const actionRow = getBossBattleActionRow(battle_id, firstParticipant.discordUserId, true, firstPlayerSkillsData.length > 0);
    
    const battleMessage = await interaction.channel.send({ embeds: [embed], components: [actionRow] });
    battleState.message_interaction = battleMessage; 
    
    await interaction.followUp({ content: `Boss battle initiated! See the message above.`, ephemeral: true});
}

async function handleBossBattleAction(interaction) {
    const customIdParts = interaction.customId.split('_');
    const actionType = customIdParts[1]; 
    const battle_id = customIdParts[2];
    const actingPlayerDiscordId = customIdParts[3]; 

    const battleState = activeBossBattles.get(battle_id);

    if (!battleState) {
        await interaction.update({ content: "This boss battle has ended or is no longer valid.", components: [] });
        return;
    }

    const currentParticipantIndex = battleState.current_turn_participant_index;
    const currentParticipant = battleState.participants[currentParticipantIndex];

    if (interaction.user.id !== currentParticipant.discordUserId || interaction.user.id !== actingPlayerDiscordId) {
        await interaction.reply({ content: "It's not your turn or this button is not for you!", ephemeral: true });
        return;
    }
    
    await interaction.deferUpdate(); 
    battleState.battle_log = [`\n--- Turn ${battleState.turn_count} (Player: ${currentParticipant.name}) ---`]; 
    
    const db = new sqlite3.Database(dbPath);
    
    // Refresh current participant's full data from DB and sync hp/mp with battle state before their turn effects
    currentParticipant.playerData = await new Promise((res,rej)=>db.get("SELECT * FROM players WHERE player_id = ?", [currentParticipant.playerId], (e,r)=>e?rej(e):res(r))) || currentParticipant.playerData;
    currentParticipant.hp = currentParticipant.playerData.hp; 
    currentParticipant.mp = currentParticipant.playerData.mp;

    const playerEffectResult = await processStatusEffects(currentParticipant, true, db, battleState.battle_log, battleState);
    
    if (playerEffectResult.isDefeated) {
        battleState.battle_log.push(`${currentParticipant.name} succumbed to status effects!`);
        if (battleState.participants.every(p => p.hp <= 0)) {
            await endBossBattle(battleState, false, db);
        } else {
            await executeBossTurn(battleState, db); 
        }
        db.close(); return;
    }
    if (playerEffectResult.isStunned) {
        battleState.battle_log.push(`${currentParticipant.name} is stunned and cannot act!`);
        await executeBossTurn(battleState, db); 
        db.close(); return;
    }

    if (actionType === 'attack') {
        const modifiedPlayerStats = applyEffectsToStats(currentParticipant.playerData, currentParticipant.effects);
        const modifiedBossStats = applyEffectsToStats(battleState.boss_data, battleState.boss_effects);
        const damage = Math.max(1, (modifiedPlayerStats.strength || 10) - (modifiedBossStats.defense || 0));
        battleState.boss_current_hp -= damage;
        battleState.battle_log.push(`${currentParticipant.name} attacks ${battleState.boss_data.name} for ${damage} damage.`);
    } else if (actionType === 'show_skills') {
        const playerSkills = await new Promise((resolve, reject) => {
            db.all(`SELECT s.skill_id, s.name, s.mp_cost, s.description FROM skills s JOIN player_skills ps ON s.skill_id = ps.skill_id WHERE ps.player_id = ?`, [currentParticipant.playerId], (err, rows) => {
                if (err) reject(err); else resolve(rows || []);
            });
        });
        if (playerSkills.length === 0) {
            battleState.battle_log.push("You haven't learned any skills yet!");
            await updateBattleInterface(battleState, db); 
        } else {
            const skillButtons = playerSkills.map(skill => new ButtonBuilder().setCustomId(`bossbattle_use_skill_${battle_id}_${skill.skill_id}_${actingPlayerDiscordId}`).setLabel(`${skill.name} (MP: ${skill.mp_cost})`).setStyle(ButtonStyle.Success).setDisabled(currentParticipant.mp < skill.mp_cost));
            const skillActionRows = [];
            for (let i = 0; i < skillButtons.length; i += 5) skillActionRows.push(new ActionRowBuilder().addComponents(skillButtons.slice(i, i + 5)));
            if (skillActionRows.length < 5 || skillActionRows.length === 0) { 
                 skillActionRows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bossbattle_return_${battle_id}_${actingPlayerDiscordId}`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)));
            } else if (skillActionRows.length >= 5) { 
                const lastRow = skillActionRows[skillActionRows.length -1];
                if(lastRow.components.length < 5) { 
                    lastRow.addComponents(new ButtonBuilder().setCustomId(`bossbattle_return_${battle_id}_${actingPlayerDiscordId}`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                } else if (skillActionRows.length < 5) { 
                     skillActionRows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bossbattle_return_${battle_id}_${actingPlayerDiscordId}`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)));
                }
            }
            
            const skillsEmbed = new EmbedBuilder().setColor(0x0000FF).setTitle('✨ Your Skills ✨').setDescription(battleState.battle_log.join('\n') + '\nSelect a skill:');
            playerSkills.forEach(skill => skillsEmbed.addFields({name: `${skill.name} (MP: ${skill.mp_cost})`, value: skill.description.substring(0,100)}));
            await battleState.message_interaction.edit({ embeds: [skillsEmbed], components: skillActionRows });
        }
        db.close(); return; 
    } else if (actionType === 'use_skill') {
        const skillId = customIdParts[3]; 
        const skillDetails = await new Promise((res, rej) => db.get("SELECT * FROM skills WHERE skill_id = ?", [skillId], (e,r)=>e?rej(e):res(r)));
        
        if(skillDetails && currentParticipant.mp >= skillDetails.mp_cost){
            currentParticipant.mp -= skillDetails.mp_cost;
            battleState.battle_log.push(`${currentParticipant.name} uses ${skillDetails.name}!`);
            
            if(skillDetails.target_type === 'ENEMY'){
                let damage = (skillDetails.base_damage || 0);
                const modifiedPlayerAttackerStats = applyEffectsToStats(currentParticipant.playerData, currentParticipant.effects);
                const modifiedBossDefenderStats = applyEffectsToStats(battleState.boss_data, battleState.boss_effects);

                if(skillDetails.damage_multiplier) damage += Math.floor(( (currentParticipant.playerData.class === 'ساحر' ? modifiedPlayerAttackerStats.intelligence : modifiedPlayerAttackerStats.strength) || 10) * skillDetails.damage_multiplier);
                damage = Math.max(1, damage - (modifiedBossDefenderStats.defense || 0));
                battleState.boss_current_hp -= damage;
                battleState.battle_log.push(`Dealt ${damage} to ${battleState.boss_data.name}.`);
                if(skillDetails.effect_type && skillDetails.effect_duration > 0){
                     const existingEffectIndex = battleState.boss_effects.findIndex(e => e.name === skillDetails.effect_type);
                     if(existingEffectIndex > -1) {
                        battleState.boss_effects[existingEffectIndex].duration = skillDetails.effect_duration;
                        battleState.boss_effects[existingEffectIndex].value = skillDetails.effect_value; // Update value too
                     } else {
                        battleState.boss_effects.push({name: skillDetails.effect_type, value: skillDetails.effect_value, duration: skillDetails.effect_duration, source_skill_name: skillDetails.name});
                     }
                     battleState.battle_log.push(`${battleState.boss_data.name} is now ${skillDetails.effect_type}.`);
                }
            } else if (skillDetails.target_type === 'SELF'){
                if(skillDetails.heal_amount){
                    const maxHpForPlayer = (currentParticipant.playerData.level * 10) + (currentParticipant.playerData.class === 'محارب' ? 100 : 80); 
                    const actualHeal = Math.min(skillDetails.heal_amount, maxHpForPlayer - currentParticipant.hp);
                    currentParticipant.hp += actualHeal;
                    battleState.battle_log.push(`Healed self for ${actualHeal} HP.`);
                }
                 if(skillDetails.effect_type && skillDetails.effect_duration > 0){
                     const existingEffectIndex = currentParticipant.effects.findIndex(e => e.name === skillDetails.effect_type);
                     if(existingEffectIndex > -1) currentParticipant.effects[existingEffectIndex].duration = skillDetails.effect_duration;
                     else currentParticipant.effects.push({name: skillDetails.effect_type, value: skillDetails.effect_value, duration: skillDetails.effect_duration, source_skill_name: skillDetails.name});
                     battleState.battle_log.push(`You are now ${skillDetails.effect_type}.`);
                 }
            }
            // Update player's MP & HP in DB after skill use (HP might change due to HEAL_SELF)
            await new Promise((res,rej)=>db.run("UPDATE players SET mp = ?, hp = ? WHERE player_id = ?", [currentParticipant.mp, currentParticipant.hp, currentParticipant.playerId], e=>e?rej(e):res()));
        } else {
             battleState.battle_log.push(skillDetails ? `Not enough MP for ${skillDetails.name}.` : "Skill not found.");
        }
    } else if (actionType === 'return') { 
         await updateBattleInterface(battleState, db);
         db.close(); return;
    }

    if (battleState.boss_current_hp <= 0) {
        await endBossBattle(battleState, true, db);
        db.close(); return;
    }

    await executeBossTurn(battleState, db); 
    db.close(); 
}

async function executeBossTurn(battleState, db) { 
    battleState.battle_log.push(`\n--- Boss Turn (${battleState.boss_data.name}) ---`);
    
    const bossEffectsResult = await processStatusEffects(battleState.boss_data, false, db, battleState.battle_log, battleState); 
    if (bossEffectsResult.isDefeated) {
        battleState.battle_log.push(`${battleState.boss_data.name} succumbed to status effects!`);
        await endBossBattle(battleState, true, db); 
        return;
    }
    if (bossEffectsResult.isStunned) {
        battleState.battle_log.push(`${battleState.boss_data.name} is stunned and cannot act!`);
    } else {
        const randomAction = Math.random();
        let chosenBossSkill = null;

        if (battleState.boss_skills && battleState.boss_skills.length > 0 && randomAction < 0.75) { 
            const usableSkills = battleState.boss_skills.filter(s => (battleState.boss_data.mp || 0) >= (s.mp_cost || 0)); 
            if (usableSkills.length > 0) {
                chosenBossSkill = usableSkills[Math.floor(Math.random() * usableSkills.length)];
            }
        }

        const livingParticipants = battleState.participants.filter(p => p.hp > 0);
        if (livingParticipants.length === 0) { await endBossBattle(battleState, false, db); return; }
        
        if (chosenBossSkill) {
            battleState.battle_log.push(`**${battleState.boss_data.name}** uses **${chosenBossSkill.name}**!`);
            // Boss MP cost (if any)
            // battleState.boss_data.mp -= chosenBossSkill.mp_cost || 0; 

            if (chosenBossSkill.name === 'Eruption') { 
                battleState.battle_log.push(`🔥 A fiery eruption scorches all participants!`);
                for (const p of livingParticipants) {
                    const pDataForEffect = p.playerData;
                    const modifiedTargetStats = applyEffectsToStats(pDataForEffect, p.effects);
                    const damage = Math.max(1, (chosenBossSkill.base_damage || 0) - (modifiedTargetStats.defense || 0));
                    p.hp -= damage;
                    battleState.battle_log.push(`💥 ${p.name} takes ${damage} damage!`);
                    
                    // Apply BURN effect from Eruption
                    if (chosenBossSkill.effect_type === 'BURN' && chosenBossSkill.effect_duration > 0 && chosenBossSkill.effect_value !== null) {
                        const existingBurnIndex = p.effects.findIndex(e => e.name === 'BURN');
                        if (existingBurnIndex > -1) {
                            p.effects[existingBurnIndex].duration = chosenBossSkill.effect_duration;
                            p.effects[existingBurnIndex].value = chosenBossSkill.effect_value;
                        } else {
                            p.effects.push({ name: 'BURN', value: chosenBossSkill.effect_value, duration: chosenBossSkill.effect_duration, source_skill_name: chosenBossSkill.name });
                        }
                        battleState.battle_log.push(`🔥 ${p.name} is now burning!`);
                    }

                    if (p.hp <= 0) { p.hp = 0; battleState.battle_log.push(`☠️ ${p.name} has been defeated!`); }
                    await new Promise((res,rej)=>db.run('UPDATE players SET hp = ? WHERE player_id = ?', [p.hp, p.playerId], e=>e?rej(e):res()));
                }
            } else if (chosenBossSkill.name === 'Magma Shield') {
                const effect = {name: chosenBossSkill.effect_type, value: chosenBossSkill.effect_value, duration: chosenBossSkill.effect_duration, source_skill_name: chosenBossSkill.name};
                const existingEffectIndex = battleState.boss_effects.findIndex(e => e.name === effect.name);
                if(existingEffectIndex > -1) battleState.boss_effects[existingEffectIndex] = effect; else battleState.boss_effects.push(effect);
                battleState.battle_log.push(`🛡️ ${battleState.boss_data.name} is now shielded by magma! (+${chosenBossSkill.effect_value} Defense for ${chosenBossSkill.effect_duration} turns)`);
            } else if (chosenBossSkill.name === 'Summon Fire Imps') {
                 battleState.battle_log.push(`☄️ ${battleState.boss_data.name} summons fiery imps! (Effect not fully implemented)`);
            }
        } else { 
            const targetParticipant = livingParticipants[Math.floor(Math.random() * livingParticipants.length)];
            const targetPlayerData = targetParticipant.playerData; 

            if(targetParticipant && targetParticipant.hp > 0){
                const modifiedBossStats = applyEffectsToStats(battleState.boss_data, battleState.boss_effects);
                const modifiedTargetStats = applyEffectsToStats(targetPlayerData, targetParticipant.effects);
                const bossDamage = Math.max(1, (modifiedBossStats.attack || 15) - (modifiedTargetStats.defense || 5));
                targetParticipant.hp -= bossDamage;
                battleState.battle_log.push(`⚔️ **${battleState.boss_data.name}** attacks **${targetParticipant.name}** for **${bossDamage}** damage!`);
                if (targetParticipant.hp <= 0) { targetParticipant.hp = 0; battleState.battle_log.push(`☠️ ${targetParticipant.name} has been defeated!`);}
                await new Promise((res,rej)=>db.run('UPDATE players SET hp = ? WHERE player_id = ?', [targetParticipant.hp, targetParticipant.playerId], e=>e?rej(e):res()));
            }
        }
    }
    
    // Update full playerData for all participants in battleState after boss turn and potential player HP changes
    for (const p of battleState.participants) {
        // Fetch fresh data for participant from DB to update battleState's copy
        const updatedPData = await new Promise((res,rej)=>db.get("SELECT * FROM players WHERE player_id = ?", [p.playerId], (e,r)=>e?rej(e):res(r)));
        if(updatedPData) {
            p.playerData = updatedPData; 
            p.hp = updatedPData.hp; 
            p.mp = updatedPData.mp; 
        }
    }

    if (battleState.participants.every(p => p.hp <= 0)) {
        await endBossBattle(battleState, false, db);
        return;
    }
    
    battleState.current_turn_participant_index = (battleState.current_turn_participant_index + 1) % battleState.participants.length;
    while(battleState.participants[battleState.current_turn_participant_index].hp <= 0){
        battleState.current_turn_participant_index = (battleState.current_turn_participant_index + 1) % battleState.participants.length;
    }
    battleState.turn_count++;
    const nextPlayer = battleState.participants[battleState.current_turn_participant_index];
    battleState.battle_log.push(`\n➡️ It's now **${nextPlayer.name}**'s turn!`);

    await updateBattleInterface(battleState, db); 
}

async function updateBattleInterface(battleState, dbInstance) { 
    if (!battleState.message_interaction || !battleState.message_interaction.edit) {
        console.error("Cannot update battle interface: message_interaction is not valid.");
        return;
    }
    
    const currentTurnPlayer = battleState.participants[battleState.current_turn_participant_index];
    const embed = new EmbedBuilder()
        .setColor(battleState.boss_current_hp > 0 ? 0xFF0000 : 0x00FF00)
        .setTitle(`🔥 Boss Battle! 🔥 - ${battleState.boss_data.name} (Turn ${battleState.turn_count})`)
        .setDescription(battleState.battle_log.slice(-10).join('\n')) 
        .addFields({ name: `${battleState.boss_data.name} HP`, value: `❤️ ${battleState.boss_current_hp}/${battleState.boss_data.hp}`, inline: false })
        .addFields({ name: `🔴 ${battleState.boss_data.name}'s Effects`, value: formatActiveEffects(battleState.boss_effects) || "لا يوجد", inline: false });


    battleState.participants.forEach(p => {
        const status = p.hp <= 0 ? "💀 DEFEATED" : `❤️ ${p.hp}/${p.playerData.hp} | 💧 ${p.mp}/${p.playerData.mp}`;
        const turnIndicator = p.discordUserId === currentTurnPlayer.discordUserId && p.hp > 0 ? '(Current Turn)' : '';
        const playerEffectsString = formatActiveEffects(p.effects);
        
        embed.addFields(
            { name: `${p.name} ${turnIndicator}`, value: status, inline: true },
            { name: `🔵 ${p.name}'s Effects`, value: playerEffectsString, inline: true }
        );
        // Add a blank field if there's an odd number of participants to keep alignment, or handle layout differently
        if (battleState.participants.length % 2 !== 0 && battleState.participants.indexOf(p) === battleState.participants.length -1 && battleState.participants.length > 1) {
            //This check is basic, might need refinement for more complex layouts or many participants
        }
    });
    
    let components = [];
    if (battleState.boss_current_hp > 0 && battleState.participants.some(p => p.hp > 0)) {
        const db = dbInstance || new sqlite3.Database(dbPath); 
        const skills = await new Promise((resolve, reject) => {
            if (currentTurnPlayer && currentTurnPlayer.playerId) {
                db.all("SELECT skill_id FROM player_skills WHERE player_id = ?", [currentTurnPlayer.playerId], (err, r) => err ? reject(err) : resolve(r || []));
            } else {
                resolve([]); 
            }
        });
        if(!dbInstance && db.open) db.close(); 
        
        components.push(getBossBattleActionRow(battleState.battle_id, currentTurnPlayer.discordUserId, true, skills.length > 0));
    }

    try {
        await battleState.message_interaction.edit({ embeds: [embed], components: components });
    } catch (error) {
        console.error("Failed to edit battle message:", error);
    }
}

async function endBossBattle(battleState, playerWon, dbInstance) { 
    const battleId = battleState.battle_id; 
    activeBossBattles.delete(battleId);

    let finalMessage = `**${battleState.boss_data.name} has been defeated!**\nCongratulations to the victors!`;
    if (!playerWon) {
        finalMessage = `**${battleState.boss_data.name} has defeated the party!**\nBetter luck next time.`;
    }
    
    const db = dbInstance || new sqlite3.Database(dbPath);

    if (playerWon) {
        const livingParticipants = battleState.participants.filter(p => p.hp > 0);
        if (livingParticipants.length > 0) {
            const xpShare = Math.floor(battleState.boss_data.xp_reward / livingParticipants.length) || 0;
            const coinShare = Math.floor(battleState.boss_data.coins_reward / livingParticipants.length) || 0;
            finalMessage += `\n\n**Rewards:**\nEach surviving hero receives ${xpShare} XP and ${coinShare} Shadow Coins.`;

            for (const participant of livingParticipants) {
                // Fetch full data for update as participant.playerData might be stale or only initial
                let pDataToUpdate = await new Promise((res,rej)=>db.get("SELECT * FROM players WHERE player_id = ?", [participant.playerId], (e,r)=>e?rej(e):res(r)));
                if(!pDataToUpdate) continue; // Skip if player data not found

                pDataToUpdate.xp = (pDataToUpdate.xp || 0) + xpShare;
                pDataToUpdate.shadow_coins = (pDataToUpdate.shadow_coins || 0) + coinShare;
                // HP/MP are already updated in participant object throughout the battle
                pDataToUpdate.hp = participant.hp; 
                pDataToUpdate.mp = participant.mp;

                let { leveledUp, levelUpMessages } = await handleLevelUp(db, pDataToUpdate); 
                if (leveledUp) {
                    const lvlUpMsg = `\n🎉 ${pDataToUpdate.name} ${levelUpMessages}`;
                    finalMessage += lvlUpMsg;
                    // DM other players about their level up
                    if (pDataToUpdate.discord_user_id !== battleState.client.user.id && battleState.client) { 
                        const user = await battleState.client.users.fetch(participant.discordUserId).catch(()=>null);
                        if(user) user.send(`You helped defeat ${battleState.boss_data.name} and gained rewards! ${levelUpMessages}`).catch(console.error);
                    }
                }
                // Update all stats that might have changed due to level up
                await new Promise((resolve,reject) => {
                    db.run(`UPDATE players SET xp = ?, shadow_coins = ?, level = ?, hp=?, mp=?, strength=?, defense=?, intelligence=?, speed=? WHERE player_id = ?`, 
                           [pDataToUpdate.xp, pDataToUpdate.shadow_coins, pDataToUpdate.level, pDataToUpdate.hp, pDataToUpdate.mp, pDataToUpdate.strength, pDataToUpdate.defense, pDataToUpdate.intelligence, pDataToUpdate.speed, pDataToUpdate.player_id], 
                           (err) => { if(err) {console.error("Error updating player rewards after boss", err.message); reject(err);} else resolve();});
                });
            }
        } else {
             finalMessage += `\n\nUnfortunately, no one survived to claim the rewards.`;
        }
    }
    
    const finalEmbed = new EmbedBuilder()
        .setColor(playerWon ? 0x00FF00 : 0xFF0000)
        .setTitle(playerWon ? '🏆 Boss Defeated! 🏆' : '💀 Party Wiped! 💀')
        .setDescription(finalMessage)
        .setTimestamp();

    if (battleState.message_interaction && battleState.message_interaction.edit) {
        try {
            await battleState.message_interaction.edit({ embeds: [finalEmbed], components: [] }); 
        } catch (error) {
            console.error("Failed to edit final battle message:", error);
            if (battleState.message_interaction.channel) { 
                 battleState.message_interaction.channel.send({ embeds: [finalEmbed], components: [] });
            }
        }
    } else if (battleState.message_interaction && battleState.message_interaction.channel) { 
        battleState.message_interaction.channel.send({ embeds: [finalEmbed], components: [] });
    }
    if(!dbInstance && db.open) db.close((err) => { if(err) console.error("Error closing DB in endBossBattle:", err.message);}); 
}

async function updateKillQuestProgress(db, playerId, enemyName, client, interactionUserId) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT pq.player_quest_id, pq.quest_id, pq.current_progress, q.name as quest_name, q.target_quantity 
            FROM player_quests pq
            JOIN quests q ON pq.quest_id = q.quest_id
            WHERE pq.player_id = ? AND pq.status = 'ACCEPTED' AND q.type = 'KILL' AND q.target_name = ?
        `, [playerId, enemyName], async (err, activeKillQuests) => {
            if (err) {
                console.error(`Error fetching active kill quests for player ${playerId}, enemy ${enemyName}:`, err.message);
                return reject(err);
            }

            let questUpdatesLog = [];

            for (const quest of activeKillQuests) {
                const newProgress = (quest.current_progress || 0) + 1;
                let newStatus = quest.status;

                if (newProgress >= quest.target_quantity) {
                    newStatus = 'COMPLETED_PENDING_REWARD';
                    questUpdatesLog.push(`🎉 Quest Completed: "${quest.quest_name}"! You can now hand it in.`);
                } else {
                    questUpdatesLog.push(`🎯 Quest Progress: "${quest.quest_name}" - ${newProgress}/${quest.target_quantity} ${enemyName}s defeated.`);
                }

                await new Promise((res, rej) => {
                    db.run(`UPDATE player_quests SET current_progress = ?, status = ? WHERE player_quest_id = ?`, 
                           [newProgress, newStatus, quest.player_quest_id], function(updateErr) {
                        if (updateErr) {
                            console.error(`Error updating quest progress for player ${playerId}, quest ${quest.quest_id}:`, updateErr.message);
                            // Continue to next quest if one fails
                        }
                        res();
                    });
                });
            }
            resolve(questUpdatesLog);
        });
    });
}


module.exports = {
    startBossBattle,
    handleBossBattleAction,
    // Expose activeBossBattles for explore.js to check if a boss battle is active on the user by another user.
    // This is a simplified way; a proper event system or shared state manager would be better.
    activeBossBattles, 
};
