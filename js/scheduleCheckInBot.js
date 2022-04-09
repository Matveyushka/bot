import axios from 'axios'
import htmlParser from 'node-html-parser'
import qs from 'qs'
import iconv from 'iconv-lite'

axios.defaults.withCredentials = true

const checkInResult = {
    SUCCESS: Symbol('success'),
    ALREADY_CHECKED: Symbol('already-checked'),
    NOT_AVAILABLE: Symbol('not-available'),
    FAIL: Symbol('fail')
}

const authorizationStatus = Object.freeze({
    OK: Symbol('authorization-ok'),
    NOT_ENOUGH_DATA: Symbol('authorization-not-enough-data'),
    FAIL: Symbol('authorization-failed'),
    UNKNOWN: Symbol('authorization-unknown')
})

const extractCookie = response =>
    response.headers['set-cookie']
        .reduce((result, cookie) => result + cookie.split(' ')[0] + ' ', '')
        .trim()

const parseWeekNumber = (htmlSchedule, teacher) => {
    const scheduleHead = htmlSchedule.querySelectorAll(teacher ? 'h2' : 'h3')[teacher ? 1 : 0].textContent
    return +scheduleHead.match(/[0-9]+/g)[0]
}

const parseGroup = htmlSchedule => {
    const groupHead = htmlSchedule.querySelectorAll('h3')[1].textContent
    return groupHead.split(' ').slice(3).join(' ')
}

const getClassId = (htmlSchedule, teacher) => {
    const anchors = htmlSchedule.querySelectorAll('a')
    let result = -1

    anchors.forEach(anchor => {
        const regex = teacher ? /open_zan\('[0-9]+',[0-9]+\)/ : /open_zan\([0-9]+,[0-9]+\)/
        if (anchor.attributes.onclick !== undefined &&
            regex.test(anchor.attributes.onclick)) {
            const beginClassPlace = anchor.attributes.onclick.match(regex)[0]
            result = +beginClassPlace.match(/[0-9]+/g)[0]
        }
    });

    return result
}

const getCheckTime = htmlSchedule => {
    let hours
    let minutes
    htmlSchedule.querySelectorAll("td").forEach(td => {
        if (td.innerHTML.match(/.*>[0-9]{2}:[0-9]{2}.*$/g)) {
            hours = td.textContent.match(/[0-9]{2}/g)[0]
            minutes = td.textContent.match(/[0-9]{2}/g)[1]
        }
    })
    if (hours !== undefined && minutes !== undefined) {
        const now = new Date()
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes)
    }
    else {
        return null
    }
}

const authorize = async (login, password) => {
    const initialResponse = await axios({
        method: 'get',
        url: 'https://lk.sut.ru'
    })
    const cookie = extractCookie(initialResponse)
    const authorizeResponse = await axios({
        method: 'post',
        baseURL: 'https://lk.sut.ru',
        url: '/cabinet/lib/autentificationok.php',
        headers: {
            cookie: cookie,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        data: qs.stringify({
            users: login,
            parole: password
        })
    })

    const authorizationResult = (() => {
        if (authorizeResponse.data == 1) return authorizationStatus.OK
        else if (authorizeResponse.data == 0) return authorizationStatus.NOT_ENOUGH_DATA
        else if (authorizeResponse.data.match('error')) return authorizationStatus.FAIL
        else return authorizationStatus.UNKNOWN
    })()

    return {
        authorizationResult,
        cookie
    }
}

const sendSessionValue = async (key, value, cookie) => {
    await axios({
        method: 'post',
        baseURL: 'https://lk.sut.ru',
        url: '/cabinet/lib/updatesession.php',
        headers: {
            cookie: cookie,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        data: qs.stringify({
            key,
            value
        })
    })
}

const logout = async cookie => {
    await sendSessionValue('users', '0', cookie)
    await sendSessionValue('parole', '0', cookie)
    await sendSessionValue('people_typee', '0', cookie)
}

const makeGetRequest = async (login, password, url) => {
    const { cookie } = await authorize(login, password)

    const response = await axios({
        method: 'get',
        baseURL: 'https://lk.sut.ru',
        url,
        responseType: 'arraybuffer',
        responseEncoding: 'binary',
        headers: {
            cookie: cookie,
        },
    })

    await logout(cookie)

    return response
}

const checkIn = async (login, password, teacher) => {
    const { cookie } = await authorize(login, password)

    const url = teacher ?
        '/cabinet/project/cabinet/forms/pr_raspisanie.php' :
        '/cabinet/project/cabinet/forms/raspisanie.php'

    const response = await makeGetRequest(login, password, url)

    const scheduleResponse = await response

    const htmlSchedule = htmlParser.parse(scheduleResponse.data)

    const classId = getClassId(htmlSchedule, teacher)

    const checkTime = getCheckTime(htmlSchedule)

    if (checkTime !== null) {
        return { datetime: checkTime, result: checkInResult.ALREADY_CHECKED }
    }
    else if (classId !== -1) {
        const weekNumber = parseWeekNumber(htmlSchedule, teacher)
        const response = await axios({
            method: 'post',
            baseURL: 'https://lk.sut.ru',
            url,
            headers: {
                cookie: cookie,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            data: `open=1&rasp=${classId}&week=${weekNumber}`
        })
        if (response.data.id !== undefined) {
            return { datetime: new Date(), result: checkInResult.SUCCESS }
        }
        else {
            return { datetime: null, result: checkInResult.FAIL }
        }
    } else {
        return { datetime: null, result: checkInResult.NOT_AVAILABLE }
    }
}

const getGroup = async (login, password) => {
    const response = await makeGetRequest(login, password, '/cabinet/project/cabinet/forms/raspisanie.php')

    const data = await response.data
    const decodedData = iconv.decode(data, 'windows-1251')

    const htmlSchedule = htmlParser.parse(decodedData)

    const group = parseGroup(htmlSchedule)

    return group
}

const checkIfUserIsTeacher = async (login, password) => {
    const response = await makeGetRequest(
        login,
        password,
        '/cabinet/?login=yes')

    const teacherMessageResponse = await response

    const htmlResponse = htmlParser.parse(iconv.decode(teacherMessageResponse.data, 'windows-1251'))

    return htmlResponse.querySelector('#cabinet') !== null
}

export {
    authorize,
    checkIn,
    authorizationStatus,
    checkInResult,
    getGroup,
    logout,
    checkIfUserIsTeacher
}