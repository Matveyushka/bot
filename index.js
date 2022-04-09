import { checkIn, checkInResult } from './js/scheduleCheckInBot.js'
import { log } from './js/utils.js'
import { MongoClient } from 'mongodb'
import { decryptPassword } from './js/cipher.js'

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0

const uri = process.env.dburi

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true })

let clientUsersCounter = 0

const getDbClient = async callback => {
    clientUsersCounter++
    client.connect(async err => {
        if (err !== undefined) {
            log(`database connection error: ${err}`)
        } else {
            await callback(client)
        }
        clientUsersCounter--
        if (clientUsersCounter === 0) {
            client.close()
        }
    })
}

const setTimestamp = (hours, minutes, offset = 0) => {
    const now = new Date()
    const unmovedTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes)
    const movedTimestamp = new Date(unmovedTimestamp.getTime() + offset * 60 * 1000)

    return { hours: movedTimestamp.getHours(), minutes: movedTimestamp.getMinutes() }
}

const moveTimeStamp = (timestamp, offset) => {
    return setTimestamp(timestamp.hours, timestamp.minutes, offset)
}

const createClassTimeStamps = classBeginTimeStamp => {
    return [
        moveTimeStamp(classBeginTimeStamp, -5),
        moveTimeStamp(classBeginTimeStamp, 10),
        moveTimeStamp(classBeginTimeStamp, 30),
        moveTimeStamp(classBeginTimeStamp, 80),
    ]
}

const createTeacherClassTimeStamps = classBeginTimeStamp => {
    return [
        moveTimeStamp(classBeginTimeStamp, -15),
        moveTimeStamp(classBeginTimeStamp, -10),
    ]
}

const schedule = [
    setTimestamp(9, 0, -10),
    setTimestamp(10, 45, -10),
    setTimestamp(13, 0, -10),
    setTimestamp(14, 45, -10),
    setTimestamp(16, 30, -10),
    setTimestamp(18, 15, -10),
    setTimestamp(20, 0, -10)
]

const studentSchedule = [
    ...createClassTimeStamps(setTimestamp(9, 0)),
    ...createClassTimeStamps(setTimestamp(10, 45)),
    ...createClassTimeStamps(setTimestamp(13, 0)),
    ...createClassTimeStamps(setTimestamp(14, 45)),
    ...createClassTimeStamps(setTimestamp(16, 30)),
    ...createClassTimeStamps(setTimestamp(18, 15)),
    ...createClassTimeStamps(setTimestamp(20, 0))
]

const teacherSchedule = [
    ...createTeacherClassTimeStamps(setTimestamp(9, 0)),
    ...createTeacherClassTimeStamps(setTimestamp(10, 45)),
    ...createTeacherClassTimeStamps(setTimestamp(13, 0)),
    ...createTeacherClassTimeStamps(setTimestamp(14, 45)),
    ...createTeacherClassTimeStamps(setTimestamp(16, 30)),
    ...createTeacherClassTimeStamps(setTimestamp(18, 15)),
    ...createTeacherClassTimeStamps(setTimestamp(20, 0))
]

const findNextTimestamp = (schedule, currentHours, currentMinutes) => {
    for (let i = 0; i != schedule.length; i++) {
        if (schedule[i].hours > currentHours ||
            (schedule[i].hours === currentHours && schedule[i].minutes > currentMinutes + 1)) {
            return schedule[i]
        }
    }
    return schedule[0]
}

const findLastTimestamp = (schedule, currentHours, currentMinutes) => {
    for (let i = 0; i != schedule.length; i++) {
        if (schedule[i].hours > currentHours ||
            (schedule[i].hours === currentHours && schedule[i].minutes > currentMinutes + 1)) {
            return schedule[(i + schedule.length - 1) % schedule.length]
        }
    }
    return schedule[schedule.length - 1]
}

const getTimeToWait = (nextTimestamp, currentHours, currentMinutes) => {
    if (nextTimestamp.hours > currentHours ||
        (nextTimestamp.hours === currentHours && nextTimestamp.minutes > currentMinutes + 1)) {
        return ((nextTimestamp.hours * 60 + nextTimestamp.minutes) - (currentHours * 60 + currentMinutes)) * 60 * 1000
    } else {
        return (((nextTimestamp.hours + 24) * 60 + nextTimestamp.minutes) - (currentHours * 60 + currentMinutes)) * 60 * 1000
    }
}

const notCheckedInAlready = user => user.checkInTime === undefined ||
    user.checkInTime === null ||
    user.checkInTime < getLastClassTime().getTime()

const teacherNotCheckedInAlready = teacherUser => teacherUser.teacherCheckInTime === undefined ||
    teacherUser.teacherCheckInTime === null ||
    teacherUser.teacherCheckInTime < getLastClassTime().getTime()


const checkEveryTeacherIn = () => {
    getDbClient(async client => {
        const users = await client
            .db("sut-checkin-bot")
            .collection("users")
            .find({ teacher: true })
            .toArray()

        users.forEach((user) => {
            if (teacherNotCheckedInAlready(user)) {
                setTimeout(async () => {
                    try {
                        const pass = decryptPassword(user.password)
                        log(`*** teacher ${user.login} checking in...`)
                        const checkInResponse = await checkIn(user.login, pass, true)
                        if (checkInResponse.result === checkInResult.SUCCESS) {
                            log(`teacher ${user.login} checked in at ${checkInResponse.datetime.toLocaleString()}`)
                            updateTeacherCheckInTime(user.login, checkInResponse.datetime)
                        } else if (checkInResponse.result === checkInResult.ALREADY_CHECKED) {
                            log(`teacher ${user.login} is already checked in at ${new Date(user.teacherCheckInTime).toLocaleString()}`)
                            updateTeacherCheckInTime(user.login, checkInResponse.datetime)
                        } else if (checkInResponse.result === checkInResult.NOT_AVAILABLE) {
                            log(`teacher ${user.login} cannot check in because button is not available`)
                        } else if (checkInResponse.result === checkInResult.FAIL) {
                            log(`teacher ${user.login} failed to check in`)
                        }
                    } catch (error) {
                        log(`!!!ERROR!!! ${error}`)
                    }
                }, Math.random() * 30 * 1000)
            }
            else {
                log(`teacher ${user.login}...`)
                log(`teacher ${user.login} is already checked in in ${new Date(user.teacherCheckInTime).toLocaleString()}`)
            }
        })
    })
}

const getLastClassTime = () => {
    const now = new Date()
    const scheduleStamp = findLastTimestamp(schedule, now.getHours(), now.getMinutes())
    if (now.getHours() < schedule[0].hours || (now.getHours() === schedule[0].hours && now.getMinutes() < schedule[0].minutes)) {
        const yesterday = new Date(new Date().setDate(new Date().getDate() - 1))
        return new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), scheduleStamp.hours, scheduleStamp.minutes)
    }
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), scheduleStamp.hours, scheduleStamp.minutes)
}

const getGroups = callback => {
    getDbClient(async client => {
        const groupUsers = await client
            .db("sut-checkin-bot")
            .collection("users")
            .aggregate([
                {
                    $group: {
                        _id: "$group",
                        login: {
                            $first: "$login"
                        },
                        password: {
                            $first: "$password"
                        },
                        checkInTime: {
                            $first: "$checkInTime"
                        }
                    }
                }
            ])
            .map(entry => ({
                group: entry._id,
                login: entry.login,
                password: entry.password,
                checkInTime: entry.checkInTime
            }))
            .toArray()
        await callback(groupUsers)
    })
}

const getGroupUsers = (group, callback) => {
    getDbClient(async client => {
        const groupUsers = await client
            .db("sut-checkin-bot")
            .collection("users")
            .find({ group })
            .toArray()
        await callback(groupUsers)
    })
}

const checkInGroupUsers = async group => {
    getGroupUsers(group, async users => {
        log(`checking in all users from group ${group}...`)
        for (const user of users) {
            if (notCheckedInAlready(user)) {
                log(`user ${user.login}...`)
                setTimeout(async () => {
                    try {
                        const pass = decryptPassword(user.password)
                        log(`*** user ${user.login} checking in...`)
                        const checkInResponse = await checkIn(user.login, pass, false)
                        if (checkInResponse.result === checkInResult.SUCCESS || checkInResponse.result === checkInResult.ALREADY_CHECKED) {
                            log(`user ${user.login} checked in at ${checkInResponse.datetime.toLocaleString()}`)
                            if (user.checkInTime !== checkInResponse.datetime.getTime()) 
                            {
                                updateCheckInTime(user.login, checkInResponse.datetime)
                            }
                        }
                        else if (checkInResponse.result === checkInResult.NOT_AVAILABLE) {
                            log(`user ${user.login} cannot check in because button is not available`)
                        }
                        else if (checkInResponse.result === checkInResult.FAIL) {
                            log(`user ${user.login} failed to check`)
                        }
                    } catch (error) {
                        log(`!!!ERROR!!! ${error}`)
                    }
                }, Math.random() * 60 * 1000)
            }
            else {
                log(`user ${user.login} is already checked in at ${new Date(user.checkInTime).toLocaleString()}`)
            }
        }
    })
}

const getCheckableGroups = callback => {
    const lastClass = getLastClassTime().getTime()
    getDbClient(async client => {
        const groups = await client
            .db("sut-checkin-bot")
            .collection("users")
            .aggregate([
                {
                    $match: {
                        "checkInTime": {
                            $gt: lastClass
                        }
                    }
                },
                {
                    $group: {
                        _id: "$group",
                    }
                }
            ])
            .map(group => group._id)
            .toArray()
        await callback(groups)
    })
}

const updateCheckInTime = (login, datetime) => {
    getDbClient(async client => {
        await client
            .db("sut-checkin-bot")
            .collection("users")
            .updateOne({
                "login": login
            }, {
                $set: {
                    "checkInTime": datetime.getTime()
                }
            })
    })
}

const updateTeacherCheckInTime = (login, datetime) => {
    getDbClient(async client => {
        await client
            .db("sut-checkin-bot")
            .collection("users")
            .updateOne({
                "login": login
            }, {
                $set: {
                    "teacherCheckInTime": datetime.getTime()
                }
            })
    })
}

const teacherCheckCycle = () => {
    log('teachers checking in...')
    checkEveryTeacherIn()
    const now = new Date()
    const currentHours = now.getHours()
    const currentMinutes = now.getMinutes()
    const nextTimestamp = findNextTimestamp(teacherSchedule, currentHours, currentMinutes)
    log(`next teacher checking in will be at ${nextTimestamp.hours}:${nextTimestamp.minutes}`)
    setTimeout(() => teacherCheckCycle(), getTimeToWait(nextTimestamp, currentHours, currentMinutes))
}

const studentCheckCycle = () => {
    log('students checking in...')
    const now = new Date()

    getGroups(async groups => {
        for (const group of groups) {
            log(`group ${group.group} by user ${group.login}...`)
            if (notCheckedInAlready(group)) {
                log(`group ${group.group} is not checked in...`)
                setTimeout(async () => {
                    try {
                        const pass = decryptPassword(group.password)
                        log(`*** group ${group.group} checking in by user ${group.login}...`)
                        const checkInResponse = await checkIn(group.login, pass, false)
                        if (checkInResponse.result === checkInResult.SUCCESS || checkInResponse.result === checkInResult.ALREADY_CHECKED) {
                            log(`group ${group.group} first checked in by ${group.login} at ${checkInResponse.datetime.toLocaleString()}`)
                            if (group.checkInTime !== checkInResponse.datetime.getTime()) 
                            {
                                updateCheckInTime(group.login, checkInResponse.datetime)
                            }
                            checkInGroupUsers(group.group)
                        }
                        else if (checkInResponse.result === checkInResult.NOT_AVAILABLE) {
                            log(`group ${group.group} cannot check in because button is not available`)
                        }
                        else if (checkInResponse.result === checkInResult.FAIL) {
                            log(`group ${group.group} failed to check in`)
                        }
                    } catch (error) {
                        log(`!!!ERROR!!! ${error}`)
                    }
                }, Math.random() * 15 * 1000)
            }
            else {
                log(`group ${group.group} first checked in by ${group.login}`)
                checkInGroupUsers(group.group)
            }
        }
    })

    const currentHours = now.getHours()
    const currentMinutes = now.getMinutes()
    const nextTimestamp = findNextTimestamp(studentSchedule, currentHours, currentMinutes)
    log(`next students checking in will be at ${nextTimestamp.hours}:${nextTimestamp.minutes}`)
    setTimeout(() => studentCheckCycle(), getTimeToWait(nextTimestamp, currentHours, currentMinutes))
}

teacherCheckCycle()
studentCheckCycle()