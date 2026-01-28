import { Sequelize } from 'sequelize';
import config from '../config';

// Model imports
import { initBgpSessionsModel, type BgpSessionsModel } from './models/bgpSessions';
import { initRoutersModel, type RoutersModel } from './models/routers';
import { initUsersModel, type UsersModel } from './models/users';
import { initSettingsModel, type SettingsModel } from './models/settings';
import { initAuditLogsModel, type AuditLogsModel } from './models/auditLogs';
import { initBirdPoliciesModel, type BirdPoliciesModel } from './models/birdPolicies';

let sequelize: Sequelize | null = null;

export interface Models {
    bgpSessions: BgpSessionsModel;
    routers: RoutersModel;
    users: UsersModel;
    settings: SettingsModel;
    auditLogs: AuditLogsModel;
    birdPolicies: BirdPoliciesModel;
}

let models: Models | null = null;

export async function initDatabase(): Promise<void> {
    sequelize = new Sequelize({
        dialect: config.database.dialect,
        host: config.database.host,
        port: config.database.port,
        database: config.database.database,
        username: config.database.username,
        password: config.database.password,
        logging: config.database.logging ? console.log : false,
        pool: {
            max: 10,
            min: 0,
            acquire: 30000,
            idle: 10000,
        },
    });

    // Test connection
    await sequelize.authenticate();

    // Initialize models
    models = {
        bgpSessions: initBgpSessionsModel(sequelize),
        routers: initRoutersModel(sequelize),
        users: initUsersModel(sequelize),
        settings: initSettingsModel(sequelize),
        auditLogs: initAuditLogsModel(sequelize),
        birdPolicies: initBirdPoliciesModel(sequelize),
    };

    // Sync models (in development)
    if (process.env.NODE_ENV !== 'production') {
        await sequelize.sync({ alter: true });
    }
}

export function getModels(): Models {
    if (!models) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return models;
}

export function getSequelize(): Sequelize {
    if (!sequelize) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return sequelize;
}
