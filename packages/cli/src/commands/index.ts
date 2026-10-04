import type { CommandSpec } from '../command.js'
import { exportCommand } from './export.js'
import { importCommand } from './import.js'
import { login } from './login.js'
import { logout } from './logout.js'
import { types } from './types.js'
import { whoami } from './whoami.js'

export const commands: CommandSpec[] = [login, logout, whoami, types, exportCommand, importCommand]
