/**
 * Development / demo seed.
 *
 * Creates a small but realistic dataset:
 *   • a senior with a health profile, medicines, vitals and check-ins
 *   • a caregiver who is linked to the senior
 *   • emergency contacts (daughter, son, GP surgery)
 *
 * The script is idempotent: every record is created with an `upsert` keyed on
 * a natural key, so it can be re-run without duplicating data.
 *
 * Run with: npm run prisma:seed
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/lib/crypto.js";
import { resolveDatabaseSchema } from "../src/lib/database.js";

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://seniorcare:seniorcare_dev_pw@127.0.0.1:5432/seniorcare?schema=public";

const schema = resolveDatabaseSchema(connectionString);

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    { connectionString, max: 5, ...schema.pool },
    schema.adapter,
  ),
});

const SENIOR = {
  email: "margaret@example.com",
  password: "SeniorCare2024",
  name: "Margaret Chen",
  phone: "+44 7700 900123",
  timeZone: "Europe/London",
};

const CAREGIVER = {
  email: "david@example.com",
  password: "SeniorCare2024",
  name: "David Chen",
  phone: "+44 7700 900456",
  timeZone: "Europe/London",
};

/** A clinician with read-only access — used to verify the scope checks. */
const DOCTOR = {
  email: "dr.okafor@example.com",
  password: "SeniorCare2024",
  name: "Dr. Amara Okafor",
  phone: "+44 20 7946 0958",
  timeZone: "Europe/London",
};

async function main(): Promise<void> {
  console.log("🌱 Seeding SeniorCare…");

  const seniorPasswordHash = await hashPassword(SENIOR.password);
  const caregiverPasswordHash = await hashPassword(CAREGIVER.password);

  // --- Senior ------------------------------------------------------------
  const senior = await prisma.user.upsert({
    where: { email: SENIOR.email },
    update: { name: SENIOR.name, timeZone: SENIOR.timeZone },
    create: {
      email: SENIOR.email,
      passwordHash: seniorPasswordHash,
      name: SENIOR.name,
      phone: SENIOR.phone,
      role: "SENIOR",
      timeZone: SENIOR.timeZone,
    },
  });

  const elder = await prisma.elder.upsert({
    where: { userId: senior.id },
    update: {},
    create: {
      userId: senior.id,
      displayName: SENIOR.name,
      dateOfBirth: new Date("1941-04-18T00:00:00.000Z"),
      bloodType: "O+",
      conditions: ["Hypertension", "Type 2 diabetes"],
      allergies: ["Penicillin"],
      medicalNotes:
        "Takes regular medication. Prefers to be contacted on the mobile number. Slight hearing loss — please ring twice.",
      checkInDeadlineHour: 21,
    },
  });

  // --- Caregiver ---------------------------------------------------------
  const caregiver = await prisma.user.upsert({
    where: { email: CAREGIVER.email },
    update: { name: CAREGIVER.name, timeZone: CAREGIVER.timeZone },
    create: {
      email: CAREGIVER.email,
      passwordHash: caregiverPasswordHash,
      name: CAREGIVER.name,
      phone: CAREGIVER.phone,
      role: "CAREGIVER",
      timeZone: CAREGIVER.timeZone,
    },
  });

  await prisma.careLink.upsert({
    where: { elderId_caregiverId: { elderId: elder.id, caregiverId: caregiver.id } },
    update: { status: "ACTIVE" },
    create: {
      elderId: elder.id,
      caregiverId: caregiver.id,
      relation: "FAMILY",
      status: "ACTIVE",
      isPrimary: true,
      canViewVitals: true,
      canManageMedicines: true,
      canManageContacts: true,
      canAcknowledgeSos: true,
      acceptedAt: new Date(),
    },
  });

  // --- Read-only clinician ------------------------------------------------
  const doctor = await prisma.user.upsert({
    where: { email: DOCTOR.email },
    update: { name: DOCTOR.name, timeZone: DOCTOR.timeZone },
    create: {
      email: DOCTOR.email,
      passwordHash: caregiverPasswordHash,
      name: DOCTOR.name,
      phone: DOCTOR.phone,
      role: "CAREGIVER",
      timeZone: DOCTOR.timeZone,
    },
  });

  await prisma.careLink.upsert({
    where: { elderId_caregiverId: { elderId: elder.id, caregiverId: doctor.id } },
    update: { status: "ACTIVE" },
    create: {
      elderId: elder.id,
      caregiverId: doctor.id,
      relation: "DOCTOR",
      status: "ACTIVE",
      // A doctor may read the readings and acknowledge an alert, but must not
      // be able to change the medication plan or the contact list.
      canViewVitals: true,
      canManageMedicines: false,
      canManageContacts: false,
      canAcknowledgeSos: true,
      acceptedAt: new Date(),
    },
  });

  // --- Emergency contacts -------------------------------------------------
  const contacts = [
    {
      name: "Sophie Chen",
      phone: "+44 7700 900789",
      email: "sophie.chen@example.com",
      relation: "FAMILY" as const,
      priority: 1,
      receivesMedicationReminders: true,
    },
    {
      name: "Dr. Amara Okafor",
      phone: "+44 20 7946 0958",
      email: "reception@oakfield-surgery.example.com",
      relation: "DOCTOR" as const,
      priority: 5,
      isDoctor: true,
      receivesMedicationReminders: false,
    },
    {
      name: "Ashwell Care (home visits)",
      phone: "+44 20 7946 0111",
      email: null,
      relation: "CAREGIVER" as const,
      priority: 8,
      receivesMedicationReminders: false,
    },
  ];

  for (const contact of contacts) {
    const existing = await prisma.emergencyContact.findFirst({
      where: { elderId: elder.id, name: contact.name },
    });
    if (!existing) {
      await prisma.emergencyContact.create({ data: { elderId: elder.id, ...contact } });
    }
  }

  // --- Medications --------------------------------------------------------
  const medicationSpecs = [
    {
      name: "Amlodipine",
      dosage: "5 mg",
      instructions: "Take in the morning with water.",
      scheduleType: "DAILY" as const,
      times: ["08:00"],
      daysOfWeek: [],
      intervalMinutes: null,
      notifyCaregivers: true,
    },
    {
      name: "Metformin",
      dosage: "500 mg",
      instructions: "Take with food to avoid stomach upset.",
      scheduleType: "DAILY" as const,
      times: ["08:00", "19:00"],
      daysOfWeek: [],
      intervalMinutes: null,
      notifyCaregivers: true,
    },
    {
      name: "Atorvastatin",
      dosage: "20 mg",
      instructions: "Take at night.",
      scheduleType: "DAILY" as const,
      times: ["22:00"],
      daysOfWeek: [],
      intervalMinutes: null,
      notifyCaregivers: false,
    },
    {
      name: "Alendronic acid",
      dosage: "70 mg",
      instructions: "Take on an empty stomach with a full glass of water.",
      scheduleType: "WEEKLY" as const,
      times: ["07:30"],
      daysOfWeek: [1],
      intervalMinutes: null,
      notifyCaregivers: true,
    },
  ];

  for (const spec of medicationSpecs) {
    const existing = await prisma.medication.findFirst({
      where: { elderId: elder.id, name: spec.name },
    });
    if (!existing) {
      await prisma.medication.create({
        data: {
          elderId: elder.id,
          startDate: new Date(),
          ...spec,
        },
      });
    }
  }

  // --- Check-ins (last 14 days) ------------------------------------------
  const existingCheckIns = await prisma.checkIn.count({ where: { elderId: elder.id } });
  if (existingCheckIns === 0) {
    const checkIns = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const createdAt = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
      createdAt.setHours(9, 15, 0, 0);

      // One missed day makes the demo data realistic.
      if (offset === 6) continue;

      checkIns.push({
        elderId: elder.id,
        status: "SAFE" as const,
        mood: offset % 5 === 0 ? 4 : 5,
        createdAt,
      });
    }
    await prisma.checkIn.createMany({ data: checkIns });
  }

  // --- Vitals (last 30 days) ----------------------------------------------
  const existingVitals = await prisma.vital.count({ where: { elderId: elder.id } });
  if (existingVitals === 0) {
    const vitals = [];
    for (let offset = 29; offset >= 0; offset -= 1) {
      const day = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
      day.setHours(8, 30, 0, 0);

      // A gentle upward trend in blood pressure with one critical reading.
      const systolic = 132 + Math.round(Math.sin(offset / 4) * 8) + Math.floor(offset / 10) * 3;
      const diastolic = 78 + Math.round(Math.cos(offset / 5) * 5);

      vitals.push({
        elderId: elder.id,
        type: "BLOOD_PRESSURE" as const,
        value: offset === 4 ? 188 : systolic,
        value2: offset === 4 ? 121 : diastolic,
        unit: "mmHg",
        isCritical: offset === 4,
        warning:
          offset === 4
            ? "Blood pressure is in the hypertensive crisis range. Seek medical help now."
            : null,
        measuredAt: day,
      });

      vitals.push({
        elderId: elder.id,
        type: "BLOOD_SUGAR" as const,
        value: 104 + Math.round(Math.cos(offset / 3) * 18),
        unit: "mg/dL",
        isCritical: false,
        measuredAt: new Date(day.getTime() + 30 * 60 * 1000),
      });

      vitals.push({
        elderId: elder.id,
        type: "HEART_RATE" as const,
        value: 68 + Math.round(Math.sin(offset / 2) * 9),
        unit: "bpm",
        isCritical: false,
        measuredAt: new Date(day.getTime() + 60 * 60 * 1000),
      });

      if (offset % 2 === 0) {
        vitals.push({
          elderId: elder.id,
          type: "TEMPERATURE" as const,
          value: 36.6 + Math.round(Math.sin(offset / 3) * 3) / 10,
          unit: "°C",
          isCritical: false,
          measuredAt: new Date(day.getTime() + 90 * 60 * 1000),
        });
      }
    }
    await prisma.vital.createMany({ data: vitals });
  }

  // --- A resolved SOS from last week --------------------------------------
  const existingAlerts = await prisma.sosAlert.count({ where: { elderId: elder.id } });
  if (existingAlerts === 0) {
    const createdAt = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    await prisma.sosAlert.create({
      data: {
        elderId: elder.id,
        triggeredByUserId: senior.id,
        status: "RESOLVED",
        message: "Fell in the garden, needed a hand getting up.",
        latitude: 51.5074,
        longitude: -0.1278,
        accuracy: 20,
        locationSource: "GPS",
        createdAt,
        acknowledgedAt: new Date(createdAt.getTime() + 90_000),
        acknowledgedById: caregiver.id,
        resolvedAt: new Date(createdAt.getTime() + 22 * 60_000),
        resolvedById: caregiver.id,
        resolutionNote: "Checked in, no injuries. Fall prevented from worsening.",
      },
    });
  }

  console.log("✅ Seed complete.");
  console.log("");
  console.log("   Demo accounts (password: SeniorCare2024)");
  console.log("   ─────────────────────────────────────────");
  console.log(`   Senior    : ${SENIOR.email}`);
  console.log(`   Caregiver : ${CAREGIVER.email}`);
  console.log(`   Doctor    : ${DOCTOR.email}  (read-only access)`);
  console.log("");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
