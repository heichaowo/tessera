import { DataTypes, type ModelStatic, type Model, type Sequelize } from 'sequelize';

export interface UserAttributes {
    id: number;
    asn: number;
    email: string | null;
    telegramId: number | null;
    isAdmin: boolean;
    isBanned: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

export type UsersModel = ModelStatic<Model<UserAttributes>>;

export function initUsersModel(sequelize: Sequelize): UsersModel {
    return sequelize.define('users', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        asn: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            unique: true,
        },
        email: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        telegramId: {
            field: 'telegram_id',
            type: DataTypes.BIGINT,
            allowNull: true,
            unique: true,
        },
        isAdmin: {
            field: 'is_admin',
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        isBanned: {
            field: 'is_banned',
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
    }, {
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            { unique: true, fields: ['asn'] },
            { fields: ['telegram_id'] },
        ],
    });
}
