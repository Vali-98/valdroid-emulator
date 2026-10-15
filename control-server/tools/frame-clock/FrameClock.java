package dev.valdroid.frameclock;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.Choreographer;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;

// Deterministic continuous motion separates capture cadence from idle-screen behavior.
public final class FrameClock extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(new ClockView());
    }

    private final class ClockView extends View implements Choreographer.FrameCallback {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private long frame;
        private int touchSequence;
        private float touchX = -100, touchY = -100;

        ClockView() { super(FrameClock.this); }
        @Override protected void onAttachedToWindow() {
            super.onAttachedToWindow();
            Choreographer.getInstance().postFrameCallback(this);
        }
        @Override protected void onDetachedFromWindow() {
            Choreographer.getInstance().removeFrameCallback(this);
            super.onDetachedFromWindow();
        }
        @Override public void doFrame(long timestamp) {
            frame++;
            invalidate();
            Choreographer.getInstance().postFrameCallback(this);
        }
        @Override protected void onDraw(Canvas canvas) {
            int width = getWidth(), height = getHeight();
            for (int row = 0; row < 24; row++) {
                paint.setColor(Color.HSVToColor(new float[]{row * 15, .65f, .75f}));
                float y = row * height / 24f;
                canvas.drawRect(0, y, width, y + height / 24f + 1, paint);
                paint.setColor(Color.WHITE);
                float x = (frame * 9 + row * 43) % (width + 100) - 100;
                canvas.drawRect(x, y, x + 80, y + height / 24f, paint);
            }
            paint.setColor(Color.BLACK);
            canvas.drawRect(0, 0, width, height * .14f, paint);
            paint.setColor(Color.WHITE);
            paint.setTextSize(54);
            canvas.drawText("Frame " + frame, 30, 90, paint);
            for (int cell = 0; cell < 20; cell++) {
                boolean bit = cell < 4 ? cell % 2 == 0 : (touchSequence & (1 << (cell - 4))) != 0;
                paint.setColor(bit ? Color.GREEN : Color.BLUE);
                float left = width * (.1f + .8f * cell / 20);
                canvas.drawRect(left, height * .06f, left + width * .8f / 20 + 1, height * .10f, paint);
            }
            paint.setColor(Color.WHITE);
            canvas.drawCircle(touchX, touchY, 70, paint);
        }
        @Override public boolean onTouchEvent(MotionEvent event) {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) touchSequence = (touchSequence + 1) & 65535;
            touchX = event.getX(); touchY = event.getY();
            return true;
        }
    }
}
