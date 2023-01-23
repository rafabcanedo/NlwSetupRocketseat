import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from "./lib/prisma"
import dayjs from 'dayjs'

export async function appRoutes(app: FastifyInstance) {
 app.post('/habits', async (request) => {
  const createHabitBody = z.object({
   title: z.string(),
   weekDays: z.array(
    z.number().min(0).max(6)
   )
  })

  // [0, 1, 2, 3, 4, 5, 6] => WeekDays
 // [0, 1, 2] => Domingo, Segunda, Terça

  const { title, weekDays } = createHabitBody.parse(request.body)

  const today = dayjs().startOf('day').toDate()

  await prisma.habit.create({
    data: {
     title,
     created_at: today,
     weekDays: {
        create: weekDays.map(weekDay => {
         return {
          week_day: weekDay,
         }
        })
     }
    }
  })
 })

 app.get('/day', async (request) => {
  const getDayParams = z.object({
   date: z.coerce.date()
  })

  // localhost:3333/day?date=2023-01-13T00
  const { date } = getDayParams.parse(request.query)

  const parsedDate = dayjs(date).startOf('day')
  const weekDay = parsedDate.get('day')

  // todos hábitos possíveis
  // hábitos que já foram completados

  const possibleHabits = await prisma.habit.findMany({
    where: {
     created_at: {
      lte: date,
     },
     weekDays: {
      some: {
        week_day: weekDay,
      }
     }
    }
  })

  const day = await prisma.day.findUnique({
   where: {
    date: parsedDate.toDate(),
   },
   include: {
    dayHabits: true,
   }
  })

  const completedHabits = day?.dayHabits.map(dayHabit => {
   return dayHabit.habit_id
  })
 
 return {
  possibleHabits,
  completedHabits,
 }
})

// completando(ou não) um hábito
app.patch('/habits/:id/toggle', async (request) => {
 const toggleHabitParams = z.object({
  id: z.string().uuid(),
 })

 const { id } = toggleHabitParams.parse(request.params)

 const today = dayjs().startOf('day').toDate()

 let day = await prisma.day.findUnique({
  where: {
    date: today,
  }
 })

 if(!day) {
  day = await prisma.day.create({
    data: {
      date: today,
    }
  })
 }

 // Completando o hábito
 const dayHabit = await prisma.dayHabit.findUnique({
  where: {
   day_id_habit_id: {
    day_id: day.id,
    habit_id: id,
   }
  }
 })
 // A tabela DayHabit relaciona day_id com o habit_id(um dia com um habito), querendo dizer
 // que o habito foi concluído naquele dia
 if (dayHabit) {
  // Remover a marcação de completo
  await prisma.dayHabit.delete({
    where: {
      id: dayHabit.id,
    }
  })
 } else {
 await prisma.dayHabit.create({
  data: {
    day_id: day.id,
    habit_id: id,
  }
 })
 }
 })

 app.get('/summary', async () => {
  // [ { date: 17/01, amount: 5, completed: 1}, { date: 18/01, amount: 2, completed: 2}, {}]
  // Quando existe Query mais complexa, mais coniçoes, relacionamentos => SQL na mão (RAW)
  // Prisma ORM: RAW SQ => SQite

  const summary = await prisma.$queryRaw`
   SELECT
    D.id,
    D.date
    (
      SELECT 
       cast(count(*) as float)
      FROM day_habits DH
      WHERE DH.day_id = D.id
    ) as completed
    (
      SELECT 
       cast(count(*) as float)
      FROM habit_week_days HWD
      JOIN habits H
       ON H.id = HWD.habit_id
      WHERE
       HWD.week_day = cast(strftime('%w' D.date/1000.0, 'unixepoch') as int)
       AND H.created_at <= D.date
    ) as amount
   FROM days D
  `

  return summary
 })
}