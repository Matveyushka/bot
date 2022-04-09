const getDateTimeString = () => {
    const currentdate = new Date()
    return currentdate.getDate() + "/"
        + (currentdate.getMonth() + 1) + "/"
        + currentdate.getFullYear() + " @ "
        + currentdate.getHours() + ":"
        + currentdate.getMinutes() + ":"
        + currentdate.getSeconds()
}

const log = message => {
    console.log(`${getDateTimeString()} ${message}`)
}

export { log, getDateTimeString }