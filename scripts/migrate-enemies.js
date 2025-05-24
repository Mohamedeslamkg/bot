const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');

// Database path
const dbPath = path.join(__dirname, '..', 'data', 'shadow_realms.db');

// Data to migrate (copied from the old explore.js or similar structure)
const enemiesToMigrate = [
    // Fire World
    { name: "Lesser Fire Sprite", world_name: "Fire World", hp: 30, attack: 5, defense: 2, speed: 10, xp_reward: 10, coins_reward: 5, image_url: "https://i.imgur.com/ffkO2Q4.png" },
    { name: "Fire Lizard", world_name: "Fire World", hp: 50, attack: 8, defense: 4, speed: 7, xp_reward: 15, coins_reward: 10, image_url: "https://i.imgur.com/aAuFh2G.png" },
    { name: "Volcanic Spider", world_name: "Fire World", hp: 40, attack: 6, defense: 3, speed: 8, xp_reward: 12, coins_reward: 7, image_url: "https://i.imgur.com/R3F2k37.png" }, // Example
    { name: "Magma Slime", world_name: "Fire World", hp: 60, attack: 4, defense: 5, speed: 5, xp_reward: 18, coins_reward: 12, image_url: "https://i.imgur.com/sO9v5Yk.png" }, // Example

    // Ice World
    { name: "Ice Wisp", world_name: "Ice World", hp: 25, attack: 4, defense: 1, speed: 12, xp_reward: 8, coins_reward: 4, image_url: "https://i.imgur.com/y69kY0L.png" },
    { name: "Snow Wolf Pup", world_name: "Ice World", hp: 40, attack: 7, defense: 3, speed: 9, xp_reward: 12, coins_reward: 8, image_url: "https://i.imgur.com/J3z01DQ.png" },
    { name: "Frostling", world_name: "Ice World", hp: 35, attack: 5, defense: 2, speed: 11, xp_reward: 10, coins_reward: 6, image_url: "https://i.imgur.com/TJR1g1N.png" }, // Example
    { name: "Arctic Fox", world_name: "Ice World", hp: 30, attack: 6, defense: 1, speed: 13, xp_reward: 9, coins_reward: 5, image_url: "https://i.imgur.com/cW28N0v.png" }, // Example
];

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        return;
    }
    console.log('Connected to the shadow_realms.db database for migration.');
});

db.serialize(() => {
    const stmt = db.prepare(`INSERT INTO enemies (name, world_name, hp, attack, defense, speed, xp_reward, coins_reward, image_url) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT(name) DO NOTHING`); // Avoid duplicates if script is run multiple times

    console.log('Starting enemy data migration...');
    let migratedCount = 0;
    let skippedCount = 0;

    enemiesToMigrate.forEach(enemy => {
        stmt.run(
            enemy.name, 
            enemy.world_name, 
            enemy.hp, 
            enemy.attack, 
            enemy.defense, 
            enemy.speed, 
            enemy.xp_reward, 
            enemy.coins_reward, 
            enemy.image_url,
            function(err) { // Use function keyword to access this.changes
                if (err) {
                    console.error(`Error inserting enemy ${enemy.name}:`, err.message);
                } else {
                    if (this.changes > 0) {
                        console.log(`Migrated enemy: ${enemy.name}`);
                        migratedCount++;
                    } else {
                        console.log(`Skipped enemy (already exists?): ${enemy.name}`);
                        skippedCount++;
                    }
                }
            }
        );
    });

    stmt.finalize((err) => {
        if (err) {
            console.error('Error finalizing statement:', err.message);
        }
        console.log('Enemy data migration finished.');
        console.log(`Successfully migrated ${migratedCount} enemies.`);
        console.log(`Skipped ${skippedCount} enemies (likely duplicates).`);
        
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err.message);
            } else {
                console.log('Database connection closed.');
            }
        });
    });
});
