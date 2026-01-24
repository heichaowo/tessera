import { DataTypes, type ModelStatic, type Model, type Sequelize } from 'sequelize';

export interface RouterAttributes {
    uuid: string;
    name: string;
    location: string;
    region: string;
    publicIp: string | null;
    publicIpv6: string | null;
    wgPublicKey: string | null;
    isOpen: boolean;
    maxPeers: number;
    supportsIpv4: boolean;
    supportsIpv6: boolean;
    allowCnPeers: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

export type RoutersModel = ModelStatic<Model<RouterAttributes>>;

export function initRoutersModel(sequelize: Sequelize): RoutersModel {
    return sequelize.define('routers', {
        uuid: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        location: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        region: {
            type: DataTypes.STRING(10),
            allowNull: false,
        },
        publicIp: {
            field: 'public_ip',
            type: DataTypes.STRING,
            allowNull: true,
        },
        publicIpv6: {
            field: 'public_ipv6',
            type: DataTypes.STRING,
            allowNull: true,
        },
        wgPublicKey: {
            field: 'wg_public_key',
            type: DataTypes.STRING,
            allowNull: true,
        },
        isOpen: {
            field: 'is_open',
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        maxPeers: {
            field: 'max_peers',
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 20,
        },
        supportsIpv4: {
            field: 'supports_ipv4',
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        supportsIpv6: {
            field: 'supports_ipv6',
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        allowCnPeers: {
            field: 'allow_cn_peers',
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
    }, {
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            { fields: ['region'] },
        ],
    });
}
