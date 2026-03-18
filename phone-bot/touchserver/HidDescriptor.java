package touchserver;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/**
 * HID report descriptor and UHID struct builders for a multitouch virtual touchscreen.
 *
 * Creates a device recognized by Android's hid-multitouch.c kernel driver as a real
 * touchscreen with INPUT_PROP_DIRECT, ABS_MT_* axes, and SOURCE_TOUCHSCREEN.
 *
 * Device name "sec_touchscreen" matches Samsung's real touchscreen driver name.
 */
public class HidDescriptor {

    // UHID event types
    public static final int UHID_DESTROY = 1;
    public static final int UHID_CREATE2 = 11;
    public static final int UHID_INPUT2 = 12;

    // UHID_CREATE2 struct field sizes
    private static final int NAME_SIZE = 128;
    private static final int PHYS_SIZE = 64;
    private static final int UNIQ_SIZE = 64;
    private static final int RD_DATA_SIZE = 4096;
    private static final int CREATE2_TOTAL_SIZE = 4376; // 4 + 128 + 64 + 64 + 2 + 2 + 4 + 4 + 4 + 4 + 4096

    // Device identity
    public static final String DEVICE_NAME = "sec_touchscreen";
    public static final int BUS_USB = 3;

    // Coordinate range
    public static final int MAX_X = 4095;
    public static final int MAX_Y = 4095;
    public static final int MAX_PRESSURE = 255;
    public static final int MAX_WIDTH = 255;
    public static final int MAX_CONTACTS = 10;

    // Input report size (after report ID)
    public static final int INPUT_REPORT_SIZE = 10;

    /**
     * Multitouch HID report descriptor.
     *
     * Defines a Touch Screen (Usage Page 0x0D, Usage 0x04) which triggers
     * INPUT_PROP_DIRECT in the kernel. Single finger collection with:
     * - Tip Switch (1 bit), Contact ID (8 bit), X/Y (16 bit each, 0-4095),
     *   Pressure (8 bit, 0-255), Width (8 bit, 0-255), Contact Count (8 bit).
     * - Feature Report with Contact Count Maximum = 10.
     */
    public static final byte[] DESCRIPTOR = new byte[] {
        0x05, 0x0D,                   // Usage Page (Digitizer)
        0x09, 0x04,                   // Usage (Touch Screen)
        (byte) 0xA1, 0x01,           // Collection (Application)

        (byte) 0x85, 0x01,           // Report ID (1)
        0x09, 0x22,                   // Usage (Finger)
        (byte) 0xA1, 0x02,           // Collection (Logical)

        // Tip Switch: 1 bit
        0x09, 0x42,                   // Usage (Tip Switch)
        0x15, 0x00,                   // Logical Minimum (0)
        0x25, 0x01,                   // Logical Maximum (1)
        0x75, 0x01,                   // Report Size (1)
        (byte) 0x95, 0x01,           // Report Count (1)
        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)

        // Padding: 7 bits
        0x75, 0x07,                   // Report Size (7)
        (byte) 0x95, 0x01,           // Report Count (1)
        (byte) 0x81, 0x03,           // Input (Const, Var, Abs)

        // Contact ID: 8 bits, range 0-9
        0x09, 0x51,                   // Usage (Contact Identifier)
        0x75, 0x08,                   // Report Size (8)
        (byte) 0x95, 0x01,           // Report Count (1)
        0x15, 0x00,                   // Logical Minimum (0)
        0x25, 0x09,                   // Logical Maximum (9)
        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)

        // X Position: 16 bits, range 0-4095
        0x05, 0x01,                   // Usage Page (Generic Desktop)
        0x09, 0x30,                   // Usage (X)
        0x75, 0x10,                   // Report Size (16)
        (byte) 0x95, 0x01,           // Report Count (1)
        0x15, 0x00,                   // Logical Minimum (0)
        0x26, (byte) 0xFF, 0x0F,     // Logical Maximum (4095)
        0x46, (byte) 0xFF, 0x0F,     // Physical Maximum (4095)
        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)

        // Y Position: 16 bits, range 0-4095 (inherits X's size/range)
        0x09, 0x31,                   // Usage (Y)
        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)

        // Tip Pressure: 8 bits, range 0-255
        0x05, 0x0D,                   // Usage Page (Digitizer)
        0x09, 0x30,                   // Usage (Tip Pressure)
        0x75, 0x08,                   // Report Size (8)
        0x15, 0x00,                   // Logical Minimum (0)
        0x26, (byte) 0xFF, 0x00,     // Logical Maximum (255)
        0x46, (byte) 0xFF, 0x00,     // Physical Maximum (255)
        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)

        // Width (Touch Major): 8 bits, range 0-255 (inherits Pressure's size/range)
        0x09, 0x48,                   // Usage (Width)
        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)

        (byte) 0xC0,                  // End Collection (Logical - Finger)

        // Contact Count: 8 bits, range 0-10
        0x05, 0x0D,                   // Usage Page (Digitizer)
        0x09, 0x54,                   // Usage (Contact Count)
        0x75, 0x08,                   // Report Size (8)
        (byte) 0x95, 0x01,           // Report Count (1)
        0x15, 0x00,                   // Logical Minimum (0)
        0x25, 0x0A,                   // Logical Maximum (10)
        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)

        // Feature Report: Contact Count Maximum
        (byte) 0x85, 0x02,           // Report ID (2)
        0x09, 0x55,                   // Usage (Contact Count Maximum)
        0x25, 0x0A,                   // Logical Maximum (10)
        (byte) 0xB1, 0x02,           // Feature (Data, Var, Abs)

        (byte) 0xC0                   // End Collection (Application)
    };

    /**
     * Build UHID_CREATE2 struct (4380 bytes).
     *
     * Struct layout:
     *   0-3:     type (u32 LE) = 11
     *   4-131:   name (128 bytes, null-padded)
     *   132-195: phys (64 bytes, zeroed)
     *   196-259: uniq (64 bytes, zeroed)
     *   260-261: rd_size (u16 LE) = descriptor length
     *   262-263: bus (u16 LE) = 3 (BUS_USB)
     *   264-267: vendor (u32 LE) = 0
     *   268-271: product (u32 LE) = 0
     *   272-275: version (u32 LE) = 0
     *   276-279: country (u32 LE) = 0
     *   280-4375: rd_data (4096 bytes, descriptor + zero-padding)
     */
    public static byte[] buildCreate2() {
        ByteBuffer buf = ByteBuffer.allocate(CREATE2_TOTAL_SIZE);
        buf.order(ByteOrder.LITTLE_ENDIAN);

        // type = UHID_CREATE2 (11)
        buf.putInt(UHID_CREATE2);

        // name (128 bytes, null-padded)
        byte[] nameBytes = DEVICE_NAME.getBytes(StandardCharsets.US_ASCII);
        buf.put(nameBytes);
        buf.position(4 + NAME_SIZE);

        // phys (64 bytes, zeroed) - already zeroed by allocate
        buf.position(4 + NAME_SIZE + PHYS_SIZE);

        // uniq (64 bytes, zeroed)
        buf.position(4 + NAME_SIZE + PHYS_SIZE + UNIQ_SIZE);

        // rd_size
        buf.putShort((short) DESCRIPTOR.length);

        // bus = BUS_USB
        buf.putShort((short) BUS_USB);

        // vendor, product, version, country = 0
        buf.putInt(0); // vendor
        buf.putInt(0); // product
        buf.putInt(0); // version
        buf.putInt(0); // country

        // rd_data (descriptor bytes + zero-padding)
        buf.put(DESCRIPTOR);

        return buf.array();
    }

    /**
     * Build UHID_INPUT2 struct for a single touch event.
     *
     * Struct layout:
     *   0-3:   type (u32 LE) = 12
     *   4-5:   size (u16 LE) = 10
     *   6-15:  data (10 bytes = input report)
     *
     * Input report layout (10 bytes):
     *   Byte 0:   Report ID (0x01)
     *   Byte 1:   [bit 0] Tip Switch, [bits 1-7] padding
     *   Byte 2:   Contact ID
     *   Byte 3-4: X (u16 LE)
     *   Byte 5-6: Y (u16 LE)
     *   Byte 7:   Pressure (u8)
     *   Byte 8:   Width (u8)
     *   Byte 9:   Contact Count
     *
     * @param tipSwitch   true if finger is touching
     * @param contactId   finger slot (0-9)
     * @param x           X coordinate (0-4095)
     * @param y           Y coordinate (0-4095)
     * @param pressure    pressure value (0-255)
     * @param width       touch width (0-255)
     * @param contactCount number of active contacts
     * @return 16-byte UHID_INPUT2 struct
     */
    public static byte[] buildInput2(boolean tipSwitch, int contactId,
                                      int x, int y, int pressure, int width,
                                      int contactCount) {
        // Clamp values to valid ranges
        contactId = Math.max(0, Math.min(contactId, 9));
        x = Math.max(0, Math.min(x, MAX_X));
        y = Math.max(0, Math.min(y, MAX_Y));
        pressure = Math.max(0, Math.min(pressure, MAX_PRESSURE));
        width = Math.max(0, Math.min(width, MAX_WIDTH));
        contactCount = Math.max(0, Math.min(contactCount, MAX_CONTACTS));

        ByteBuffer buf = ByteBuffer.allocate(4 + 2 + INPUT_REPORT_SIZE);
        buf.order(ByteOrder.LITTLE_ENDIAN);

        // UHID header
        buf.putInt(UHID_INPUT2);           // type = 12
        buf.putShort((short) INPUT_REPORT_SIZE); // size = 10

        // Input report
        buf.put((byte) 0x01);             // Report ID
        buf.put((byte) (tipSwitch ? 1 : 0)); // Tip Switch in bit 0
        buf.put((byte) contactId);         // Contact ID
        buf.putShort((short) x);           // X (u16 LE)
        buf.putShort((short) y);           // Y (u16 LE)
        buf.put((byte) pressure);          // Pressure
        buf.put((byte) width);             // Width
        buf.put((byte) contactCount);      // Contact Count

        return buf.array();
    }

    /**
     * Build UHID_DESTROY struct (4 bytes).
     * Simply: type = 1 (UHID_DESTROY) as little-endian u32.
     */
    public static byte[] buildDestroy() {
        ByteBuffer buf = ByteBuffer.allocate(4);
        buf.order(ByteOrder.LITTLE_ENDIAN);
        buf.putInt(UHID_DESTROY);
        return buf.array();
    }
}
